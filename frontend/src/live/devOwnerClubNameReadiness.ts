import type { FeatureBackendContext } from './featureRouter';
import { capturePrivateProfileSession } from './privateProfileSession';
import { isExactDevG2NameTarget, sharedClubNameEnforcementEnabled } from './devCrossGroupTeamNameRoute';

export type DevClubNameReadiness =
  | 'not-applicable' | 'pending-release' | 'pending-membership'
  | 'pending-original-name' | 'pending-source-verification'
  | 'pending-owner-check' | 'ready' | 'session-changed';

type OwnerPreparation = {
  readMember: () => Promise<boolean>;
  readSavedReference: () => Promise<string | null>;
  unlockOriginal: (reference: string, original: string, active: () => void) => Promise<{ name: string; confirm: () => Promise<void>; source: FeatureBackendContext }>;
  prepareClubCopy: (source: FeatureBackendContext, name: string, club: string, active: () => void) => Promise<void>;
};

/** Pure, fail-closed invariant for a freshly joined owner's original name. */
export function parseExactOwnDevNameReference(reference: string | null, principal: string): string | null {
  if (!reference || !principal) return null;
  const match = /^pii-display-name:v1:([a-z0-9-]+):([a-z0-9-]+)$/.exec(reference);
  if (!match || match[2] !== principal || match[1] === 'aaaaa-aa') return null;
  return match[1];
}

// A write with an unknown result is NOT replayed automatically. Only the
// owner may explicitly recheck their own saved copy in a separate action.
const uncertainWrites = new Set<string>();
const inFlight = new Map<string, Promise<DevClubNameReadiness>>();
const lastReadiness = new Map<string, DevClubNameReadiness>();
let registered = false;
function bindToSession() {
  if (registered) return;
  registered = true;
  void import('./privateProfileSession').then(({ onPrivateProfileSessionRetired }) => {
    onPrivateProfileSessionRetired(() => { inFlight.clear(); uncertainWrites.clear(); lastReadiness.clear(); });
  });
}
const fingerprint = (ctx: FeatureBackendContext, club: string) =>
  `${ctx.target.host}|${ctx.target.canisterIds.identity_access}|${ctx.identity.getPrincipal().toText()}|${club}`;

/**
 * Called only AFTER an acknowledged ICP join/create receipt. The precondition
 * is NOT a grant. The owning club checks CURRENT membership, the original
 * PII canister independently checks the owner and saved original bytes, and
 * the normal release flags remain OFF until independently approved.
 *
 * A club, team, token or user profile is never permitted to select a key.
 * A failure cannot roll back the already committed membership. The status
 * remains pending and no fallback individual-name key is introduced.
 */
export async function reconcileConfirmedDevOwnerClubName(
  ctx: FeatureBackendContext,
  clubId: string,
  options: { explicitOwnerRetry?: boolean; io?: OwnerPreparation } = {},
): Promise<DevClubNameReadiness> {
  if (!isExactDevG2NameTarget(ctx.target)) return 'not-applicable';
  if (!clubId || clubId.length > 64 || clubId.includes('/') || clubId.includes('\u001f')) return 'pending-membership';
  if (!sharedClubNameEnforcementEnabled(ctx.target)) return 'pending-release';
  bindToSession();

  const identity = ctx.identity, principal = identity.getPrincipal().toText();
  if (identity.getPrincipal().isAnonymous() || principal === 'aaaaa-aa') return 'session-changed';
  const key = fingerprint(ctx,clubId);
  if (uncertainWrites.has(key) && !options.explicitOwnerRetry) return 'pending-owner-check';
  const previous = inFlight.get(key);
  if (previous) return previous;
  const session = capturePrivateProfileSession();
  const targetSnapshot = JSON.stringify(ctx.target);
  const active = () => {
    session();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== principal ||
        JSON.stringify(ctx.target) !== targetSnapshot) throw Error('Identity or club routing changed');
  };

  const prepare = async (): Promise<DevClubNameReadiness> => {
    try {
      const io = options.io ?? await livePreparation(ctx, clubId);
      active();
      if (!await io.readMember()) return 'pending-membership';
      active();
      const reference = await io.readSavedReference();
      active();
      const authority = parseExactOwnDevNameReference(reference,principal);
      if (!authority) return 'pending-original-name';
      // The original authority is selected only after it has been checked
      // against the signed, pinned registry. Never select it from an invite.
      let opened: Awaited<ReturnType<OwnerPreparation['unlockOriginal']>>;
      try { opened = await io.unlockOriginal(reference!,authority,active); }
      catch { return 'pending-source-verification'; }
      active();
      try {
        await opened.confirm();
        active();
        await io.prepareClubCopy(opened.source,opened.name,clubId,active);
        active();
        await opened.confirm();
        active();
        if (!await io.readMember()) return 'pending-membership';
        uncertainWrites.delete(key);
        return 'ready';
      } catch {
        // A message like "deadline exceeded" could mean a successful write
        // whose response was lost. No blind automatic retries of that write.
        uncertainWrites.add(key);
        return 'pending-owner-check';
      }
    } catch { return 'session-changed'; }
  };
  const task = prepare().finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
  inFlight.set(key,task);
  return task;
}


/** Read the last owner-only verification outcome, never an unscoped name. */
export function lastConfirmedDevOwnerNameReadiness(ctx: FeatureBackendContext, club: string): DevClubNameReadiness | null {
  if (!isExactDevG2NameTarget(ctx.target) || !club) return null;
  return lastReadiness.get(fingerprint(ctx,club)) ?? null;
}

/** Membership has ALREADY committed; a rejected copy never re-submits it. */
export async function afterConfirmedDevMembershipNameReadiness(
  ctx: FeatureBackendContext, club: string,
): Promise<DevClubNameReadiness> {
  let status: DevClubNameReadiness;
  try { status = await reconcileConfirmedDevOwnerClubName(ctx,club); }
  catch { status = 'pending-owner-check'; }
  if (isExactDevG2NameTarget(ctx.target) && club)
    lastReadiness.set(fingerprint(ctx,club),status);
  return status;
}

async function livePreparation(ctx: FeatureBackendContext, club: string): Promise<OwnerPreparation> {
  const [{ connectLiveClubDomain }, { connectLiveIdentityAccessClientWithIdentity },
    { createDevCrossGroupTeamNameResolver }, { readPrivateOwnProfileName, refreshPrivateOwnClubNames }] =
    await Promise.all([
      import('./domains'), import('./identityAccess'),
      import('./devCrossGroupTeamNameRoute'), import('./privateProfileNames'),
    ]);
  return {
    readMember: async () => {
      const { actor } = await connectLiveClubDomain(ctx.target,ctx.identity);
      return actor.read_has_club_membership(ctx.identity.getPrincipal(),club);
    },
    readSavedReference: async () => {
      const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target,ctx.identity);
      try { return (await client.getProfile())?.display_name ?? null; }
      finally { client.dispose(); }
    },
    unlockOriginal: async (reference,authority,active) => {
      const resolver = createDevCrossGroupTeamNameResolver(ctx);
      if (!resolver) throw Error('Pinned original name authority not available');
      const lease = await resolver(authority);
      active(); await lease.confirm();active();
      const name = await readPrivateOwnProfileName(lease.context,reference,{ scheduleBackfill:false });
      active();await lease.confirm();active();
      return { name,source:lease.context,confirm:lease.confirm };
    },
    prepareClubCopy: async (source,name,clubId,active) =>
      refreshPrivateOwnClubNames(source,name,async () => [clubId],active),
  };
}
