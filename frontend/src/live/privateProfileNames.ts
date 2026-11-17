import { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLivePiiAccessControl } from "./domains";
import { encryptPiiText, fetchPiiVetKeys, fetchClubNameVetKey, clubNamePiiId, CLUB_NAME_SCHEME_PREFIX } from "./piiVetKeys";
import { unwrapCandid } from "./features/candid";
import type { PrivateProfileAuthorityResolver } from "./privateProfileAuthority";
import type { PrivateProfileAudience } from './privateProfileAudience';
import { capturePrivateProfileSession } from './privateProfileSession';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { isLoopbackRehearsalHost } from './accountReadAdapter.mjs';
import { privateClubNameDisplaysEnabled } from './privateClubNameDisplayMode';
import { clubNameDisplaysActive, devClubNameReleaseTarget } from './devCrossGroupTeamNameRoute';

/** Dormant reference contract: publishing a reference requires the separately
 * approved identity/search cutover. The original key authority is immutable. */
const PREFIX = "pii-display-name:v1:";
const FIELD = "display_name";
/** The person's own session has not yet saved their name for this club. */
export const NAME_NOT_SHARED_YET = 'Club name copy not saved yet.';
const BATCH_SIZE = 100;
const READ_TIMEOUT_MS = 6000;

async function prepareOwnField(ctx: FeatureBackendContext, value: string): Promise<string> {
  const authority = ctx.target.canisterIds.pii_access_control;
  if (!authority) throw new Error("Private profile authority is not configured.");
  const subject = canonicalPrincipal(ctx.identity.getPrincipal().toText());
  const identity = ctx.identity;
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (ctx.identity !== identity || ctx.identity.getPrincipal().toText() !== subject || JSON.stringify(ctx.target) !== target) throw new Error("Private profile write identity or authority changed.");
  };
  canonicalPrincipal(authority);
  const ciphertext = await encryptPiiText(ctx, subject, FIELD, value);
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  await unwrapCandid(actor.register_pii(subject, FIELD, ciphertext, ctx.identity.getPrincipal()), "Save private profile field");
  active();
  const values = await readNames(ctx, [subject], FIELD, active, undefined, true);
  active();
  if (values.get(subject) !== value) throw new Error("Private profile readback was not confirmed.");
  return privateProfileNameReference(authority, subject);
}

function canonicalPrincipal(value: string): string {
  const principal = Principal.fromText(value);
  if (principal.isAnonymous() || principal.toText() !== value) {
    throw new Error("Invalid private profile identity.");
  }
  return value;
}

export function privateProfileNameReference(authority: string, subject: string): string {
  return `${PREFIX}${canonicalPrincipal(authority)}:${canonicalPrincipal(subject)}`;
}

function parseReference(value: string): { authority: string; subject: string } | null {
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    return { authority: canonicalPrincipal(parts[0]), subject: canonicalPrincipal(parts[1]) };
  } catch {
    return null;
  }
}

/** Own-profile reopening is required data, not optional roster enrichment.
 * Preserve the original owner/authority and give key derivation time to
 * finish on a device without a saved key copy; never turn a denied read into
 * an absent profile. */
export async function readPrivateOwnProfileName(ctx: FeatureBackendContext, reference: string, options: { scheduleBackfill?: boolean } = {}): Promise<string> {
  const ref = reference.startsWith(PREFIX) ? parseReference(reference) : null;
  if (!ref || ref.authority !== ctx.target.canisterIds.pii_access_control) throw new Error('Saved private-name authority does not match the configured original authority.');
  const activeSession = capturePrivateProfileSession();
  const identity = ctx.identity;
  const caller = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    activeSession();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== caller || JSON.stringify(ctx.target) !== target) throw new Error('Private profile read cancelled or changed.');
  };
  // Account aliases are authorized by the existing original PII service;
  // do not invent a new key subject or rewrite a saved reference here.
  let retired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = () => { if (retired) throw new Error('Private profile read retired.'); active(); };
  try {
    // Overlap the (public) verification-key load with the ciphertext read;
    // a first unlock on this device otherwise pays both one after another.
    try { (await import('./piiVetKeys')).prewarmPiiVerificationKey(ctx); } catch { /* optional warm-up */ }
    const names = await Promise.race([
      readNames(ctx, [ref.subject], FIELD, guard, undefined, ref.subject === caller),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { retired = true; reject(new Error('Private display name unlock timed out.')); }, 30000); }),
    ]);
    guard();
    const name = names.get(ref.subject);
    if (!name) throw new Error('Private display name could not be unlocked yet.');
    if (ref.subject === caller) {
      (await import('./ownPrivateName')).rememberOwnPrivateName(caller, name);
      if (options.scheduleBackfill !== false) scheduleOwnClubNameBackfill(ctx, caller, name);
    }
    return name;
  } finally { retired = true; clearTimeout(timer); }
}

/** Strict preparation only; does not publish the reference or erase plaintext.
 * No automatic retry after an unknown write. Always encrypt under the supplied
 * original authority and write only the authenticated caller's own name. */
export async function preparePrivateOwnProfileName(
  ctx: FeatureBackendContext,
  name: string,
): Promise<string> {
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) {
    throw new Error("A display name of at most 512 bytes is required.");
  }
  return prepareOwnField(ctx, value);
}

/** Explicit rehearsal preparation only; does not publish a profile reference.
 * The original person-key record is retained for non-club audiences. */
export async function preparePrivateOwnClubName(ctx: FeatureBackendContext, club: string, name: string): Promise<void> {
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) throw new Error('A display name of at most 512 bytes is required.');
  const piiId = clubNamePiiId(club);
  const identity = ctx.identity;
  const principal = canonicalPrincipal(identity.getPrincipal().toText());
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) throw new Error('Club name preparation changed.');
  };
  const ciphertext = await encryptPiiText(ctx, piiId, FIELD, value);
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, identity);
  active();
  const api = actor as unknown as {
    register_private_club_name: (subject: Principal, club: string, bytes: Uint8Array) => Promise<{ Ok: unknown } | { Err: string }>;
    read_private_club_name_preparation: (subject: Principal, club: string) => Promise<{ Ok: { ciphertext: number[] | Uint8Array; master_key_id: string } } | { Err: string }>;
  };
  await unwrapCandid(api.register_private_club_name(identity.getPrincipal(), club, ciphertext), 'Prepare private club name');
  active();
  const row = await unwrapCandid(api.read_private_club_name_preparation(identity.getPrincipal(), club), 'Verify private club name');
  active();
  if (row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${club}` || row.ciphertext.length !== ciphertext.length || ciphertext.some((b, i) => row.ciphertext[i] !== b)) throw new Error('Club name preparation readback mismatch.');
}

/** Normal-save connection under the dedicated club-display release. Original replacement
 * already invalidates old copies. Each refresh compares its saved original
 * atomically, so concurrent edits cannot attach stale copies to a new name.
 * Club discovery supplies current destinations, never reader grants. */
export async function refreshPrivateOwnClubNames(
  ctx: FeatureBackendContext,
  name: string,
  discoverClubs: () => Promise<readonly string[]>,
  assertSaveActive: () => void = () => {},
): Promise<void> {
  // The universal release also prepares each current club copy when the
  // account owner saves their own name. A new club join without an existing
  // copy remains fail-closed until the owner-authorised refresh completes.
  if (!privateClubNameDisplaysEnabled() && !devClubNameReleaseTarget(ctx.target) &&
      !(import.meta.env.IGNITE_LIVE_SHARED_CLUB_NAMES === '1' && ctx.target.provider === 'icp')) return;
  if (privateProfileSearchRehearsalEnabled() && !isLoopbackRehearsalHost(ctx.target.host)) throw new Error('Private name maintenance requires a loopback rehearsal target.');
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) throw new Error('A display name of at most 512 bytes is required.');
  const identity = ctx.identity;
  const subject = canonicalPrincipal(identity.getPrincipal().toText());
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    assertSaveActive();
    sessionActive();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== subject || JSON.stringify(ctx.target) !== target) throw new Error('Private name maintenance changed.');
  };
  active();
  const supplied = [...await discoverClubs()];
  active();
  if (supplied.length > 100 || supplied.some(club => typeof club !== 'string' || !club || club.length > 64 || club.includes('\u001f') || club.includes('/'))) throw new Error('Bounded exact club names required.');
  const clubs = [...new Set(supplied)];
  if (!clubs.length) return;
  const { actor } = await connectLivePiiAccessControl(ctx.target, identity);
  active();
  const originals = await unwrapCandid(actor.get_encrypted_pii_batch([subject], FIELD, 'profile_display', 'Verify own name maintenance'), 'Read original private name');
  active();
  const original = originals[0];
  if (originals.length !== 1 || !original || original.pii_id !== subject || original.field_id !== FIELD || original.master_key_id !== 'vetkey-ibe-v1') throw new Error('Exact original private name required.');
  const originalBytes = Uint8Array.from(original.ciphertext);
  if (!originalBytes.length || originalBytes.length > 4096) throw new Error('Bounded original private name required.');
  // Inspect saved copies FIRST. Re-encrypting a club name is randomized:
  // sending a new ciphertext for an already saved copy must be rejected by
  // the receiver's create-only rule. Skipping verified, existing copies also
  // avoids an unnecessary paid person-key derivation on returning sign-ins.
  // These are authenticated owner-only reads, NOT a bulk roster disclosure.
  const current = new Map<string, Uint8Array>();
  const missing: string[] = [];
  let cursor = 0;
  const checkCopy = async () => {
    while (cursor < clubs.length) {
      const club = clubs[cursor++];
      active();
      const result = await unwrapCandid(
        actor.read_private_club_name_lifecycle(identity.getPrincipal(), club, [originalBytes]),
        'Check own encrypted club-name copy',
      );
      active();
      if (result.length > 1) throw new Error('Unexpected club-name copy count.');
      const row = result[0];
      if (!row) {
        missing.push(club);
        continue;
      }
      const ciphertext = Uint8Array.from(row.ciphertext);
      if (row.pii_id !== subject || row.field_id !== FIELD ||
        row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${club}` ||
        ciphertext.length === 0 || ciphertext.length > 4096) {
        throw new Error('Own club-name copy binding changed.');
      }
      current.set(club, ciphertext);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, clubs.length) }, () => checkCopy()));
  active();
  // Zero new encryption, zero writes and zero fresh paid vetKD derivations
  // when all clubs already have a correctly bound encrypted name copy.
  if (missing.length === 0) return;
  // The original must decrypt to the exact owner-supplied name BEFORE
  // creating any missing copies. A saved copy is never a reason to infer
  // plaintext or forge a personal key for someone else.
  const keys = await fetchPiiVetKeys(ctx, [subject], FIELD, { fresh: true, assertActive: active });
  active();
  const key = keys.get(subject);
  if (!key || new TextDecoder('utf-8', { fatal: true }).decode(IbeCiphertext.deserialize(Uint8Array.from(originalBytes)).decrypt(key)) !== value) throw new Error('Original private name changed.');
  for (const club of missing) {
    active();
    const ciphertext = await encryptPiiText(ctx, clubNamePiiId(club), FIELD, value);
    active();
    // One create-only attempt per missing copy, original bytes pinned in
    // the canister's synchronous commit. Unknown replies are NEVER replayed.
    await unwrapCandid(actor.refresh_private_club_name_lifecycle(identity.getPrincipal(), club, originalBytes, ciphertext), 'Refresh private club name');
    active();
    current.set(club, ciphertext);
  }
  // Verify both pre-existing and newly written copies still match the
  // exact expected bytes. Do not expose private names or keys in errors.
  for (const club of clubs) {
    active();
    const result = await unwrapCandid(actor.read_private_club_name_lifecycle(identity.getPrincipal(), club, [originalBytes]), 'Verify refreshed private name');
    active();
    const row = result[0];
    const ciphertext = current.get(club);
    if (result.length !== 1 || !row || !ciphertext || row.pii_id !== subject ||
      row.field_id !== FIELD || row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${club}` ||
      row.ciphertext.length !== ciphertext.length ||
      ciphertext.some((b, i) => row.ciphertext[i] !== b)) {
      throw new Error('Private name maintenance readback mismatch.');
    }
  }
}

async function readNames(ctx: FeatureBackendContext, subjects: string[], field = FIELD, active: () => void = () => {}, audience?: PrivateProfileAudience, retainOwnKey = false, phase: (value: 'ciphertext' | 'vetkey' | 'decrypt' | 'confirm') => void = () => {}): Promise<Map<string, string>> {
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  const rows = await unwrapCandid(
    audience ? actor.get_private_profile_names_batch(subjects, audience) : actor.get_encrypted_pii_batch(subjects, field, "profile_display", "Read authorized personal details"),
    "Read private display names",
  );
  active();
  const wanted = new Set(subjects);
  if (rows.some(row => row.field_id !== field || !wanted.has(row.pii_id)) || new Set(rows.map(row => row.pii_id)).size !== rows.length) throw new Error("Invalid private profile response.");
  const validRows = rows;
  if (!validRows.length) return new Map();
  if (audience && validRows.length !== subjects.length) throw new Error('Private-name audience did not authorize every candidate.');
  const clubRows = validRows.filter(row => row.master_key_id?.startsWith('vetkey-club-names-'));
  if (clubRows.length && (!audience || audience.kind !== 'club' || field !== FIELD || clubRows.some(row => row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${audience.resource}`))) throw new Error('Invalid club name key scope.');
  const individualRows = validRows.filter(row => !clubRows.includes(row));
  const strictSharedClub = clubNameDisplaysActive(ctx.target) && audience?.kind === 'club';
  // A team has no independently derived member-name key after cutover.
  if (clubNameDisplaysActive(ctx.target) && audience?.kind === 'team') {
    throw new Error('Team member names must be read under their owning club key.');
  }
  // Never obtain paid person-specific keys when the selected reader promises
  // a shared club key. A member without an encrypted club copy stays unnamed
  // (reported as not yet shared) until they open the app and their own
  // session saves the club copy; this never decrypts originals.
  if (strictSharedClub && !clubRows.length) return new Map();
  if ((individualRows.length && !strictSharedClub) || clubRows.length) phase('vetkey');
  const keys = individualRows.length && !strictSharedClub ? await fetchPiiVetKeys(ctx, individualRows.map(row => row.pii_id), field, { fresh: true, assertActive: active, ...(audience ? { audience } : {}), ...(retainOwnKey && !audience ? { retainOwnKey: true } : {}) }) : new Map();
  const clubKey = clubRows.length && audience ? await fetchClubNameVetKey(ctx, clubRows.map(row => row.pii_id), audience, active) : undefined;
  if (audience && keys.size + (clubKey ? clubRows.length : 0) !== (strictSharedClub ? clubRows.length : validRows.length)) throw new Error('Private-name keys were not authorized.');
  active();
  phase('decrypt');
  const out = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const row of validRows) {
    const key = clubRows.includes(row) ? clubKey : keys.get(row.pii_id);
    if (!key) continue;
    try {
      const name = decoder.decode(IbeCiphertext.deserialize(Uint8Array.from(row.ciphertext)).decrypt(key));
      out.set(row.pii_id, name);
    } catch {
      // A malformed/wrong-key record is never displayed as ciphertext or a ref.
    }
  }
  // Even a cached shared key is used only under a fresh exact-subject read.
  // Repeat after decryption so revoked membership never publishes labels.
  if (clubRows.length && audience) {
    phase('confirm');
    const closing = await unwrapCandid(actor.get_private_profile_names_batch(subjects, audience), 'Confirm club name audience');
    active();
    if (closing.length !== rows.length || closing.some((row, i) => row.pii_id !== rows[i].pii_id || row.field_id !== field || row.master_key_id !== rows[i].master_key_id || row.ciphertext.length !== rows[i].ciphertext.length || row.ciphertext.some((b, j) => b !== rows[i].ciphertext[j]))) throw new Error('Club name audience or ciphertext changed.');
  }
  return out;
}

async function boundedRead(ctx: FeatureBackendContext, subjects: string[], active: () => void, audience?: PrivateProfileAudience, onStep?: (step: 'ciphertext' | 'vetkey' | 'decrypt' | 'confirm') => void): Promise<Map<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  let phase: 'ciphertext' | 'vetkey' | 'decrypt' | 'confirm' = 'ciphertext';
  const guard = () => {
    if (retired) throw new Error("Private profile read retired.");
    active();
  };
  try {
    return await Promise.race([
      readNames(ctx, subjects, FIELD, guard, audience, false, next => { if (!retired) { phase = next; onStep?.(next); } }),
      new Promise<Map<string, string>>((resolve, reject) => {
        // Cross-group team names require PII -> Identity -> Club double
        // verification and a fresh vetKey. A timed-out *pinned DEV team*
        // audience must report TIMEOUT rather than silently appearing as an
        // unverified empty name set; never disclose ciphertext or IDs.
        // Keep other routes' existing deadlines and neutral failure behavior.
        const sharedClubName = clubNameDisplaysActive(ctx.target) && audience?.kind === 'club';
        const devTeam = audience?.kind === 'team' &&
          ctx.target.canisterIds.identity_access === 'mq2sj-fiaaa-aaaal-qxlqa-cai';
        const crossGroupDevName = devTeam || sharedClubName;
        timer = setTimeout(() => {
          retired = true;
          if (crossGroupDevName) reject(new Error(`Private team-name ${phase} timed out.`));
          else resolve(new Map());
        }, crossGroupDevName ? 25_000 : READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (audience) throw error;
    return new Map();
  } finally {
    retired = true;
    clearTimeout(timer);
  }
}

async function boundedAuthorityCheck<T>(read: () => Promise<T>, timeoutLabel = 'Private profile authority check timed out.', timeoutMs = READ_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Purely display enrichment. No new persistent names/cache, no grants and no
 * guessed group searches. Legacy names take the zero-network path unchanged.
 * Foreign authorities require the explicit rehearsal resolver; existing readers
 * never scan groups or use the reference itself as location authorization. */
export async function hydratePrivateProfileNames<T extends { display_name: string | null; principal?: Principal }>(
  ctx: FeatureBackendContext,
  profiles: readonly T[],
  options: { signal?: AbortSignal; resolveAuthority?: PrivateProfileAuthorityResolver; audience?: PrivateProfileAudience; partialNames?: boolean; onStep?: (step: import('@/lib/nameUnlockProgress').NameUnlockStep) => void } = {},
): Promise<Array<Omit<T, "display_name"> & { display_name: string | null; name_error?: string }>> {
  // Retain the exact rows whose references were authorized. A caller changing
  // its array during an await must not attach a retained name to another row.
  profiles = profiles.map(profile => ({ ...profile }));
  options = { ...options, ...(options.audience ? { audience: { ...options.audience } } : {}) };
  let retired = false;
  const sessionActive = capturePrivateProfileSession();
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    sessionActive();
    if (retired || options.signal?.aborted || ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) {
      throw new Error("Private profile read cancelled or changed.");
    }
  };
  active();
  const references = profiles.map(profile => {
    if (!profile.display_name?.startsWith("pii-display-name:")) return undefined;
    if (!profile.display_name.startsWith(PREFIX)) return null;
    const ref = parseReference(profile.display_name);
    // A server profile may not display somebody else's private reference.
    if (ref && profile.principal && profile.principal.toText() !== ref.subject) return null;
    return ref;
  });
  const byAuthority = new Map<string, Set<string>>();
  for (const ref of references) {
    if (!ref || (!options.resolveAuthority && ref.authority !== ctx.target.canisterIds.pii_access_control)) continue;
    const subjects = byAuthority.get(ref.authority) ?? new Set<string>();
    subjects.add(ref.subject);
    byAuthority.set(ref.authority, subjects);
  }
  const names = new Map<string, Map<string, string>>();
  // Partial mode (team rosters): one original source failing, or one person
  // without a club copy, must not blank everybody else. Each unnamed person
  // carries a diagnostic instead of a silent placeholder.
  const partial = Boolean(options.audience && options.partialNames);
  const failures = new Map<string, unknown>();
  // Cross-group routes (pinned DEV team, or the club-key release) do several
  // consensus checks across groups; 6s is too short for a cold route.
  const devTeam = (options.audience?.kind === 'team' &&
    ctx.target.canisterIds.identity_access === 'mq2sj-fiaaa-aaaal-qxlqa-cai')
    || (options.audience?.kind === 'club' && clubNameDisplaysActive(ctx.target));
  const batchSize = options.audience ? 25 : BATCH_SIZE;
  const jobs = [...byAuthority].flatMap(([authority, ids]) => {
    const subjects = [...ids];
    return Array.from({ length: Math.ceil(subjects.length / batchSize) }, (_, index) => ({ authority, subjects: subjects.slice(index * batchSize, (index + 1) * batchSize) }));
  });
  // A global four-request ceiling, not four requests per group. Original-key
  // routes are checked again after all encryption/service awaits.
  const leases = new Map<string, Promise<Awaited<ReturnType<PrivateProfileAuthorityResolver>>>>();
  const routeGuards = new Map<string, () => void>();
  const readJob = async ({ authority, subjects }: typeof jobs[number]) => {
    try {
      active();
      let pendingLease = leases.get(authority);
      if (!pendingLease) {
        const resolve = options.resolveAuthority;
        pendingLease = (async () => {
          options.onStep?.('route');
          const lease = resolve ? await boundedAuthorityCheck(() => resolve(authority),
            devTeam ? 'Private team-name route opening timed out.' : undefined, devTeam ? 20_000 : undefined) : { context: ctx, confirm: async () => {} };
          active();
          if (lease.context.identity !== identity || lease.context.target.host !== ctx.target.host || lease.context.target.networkKind !== ctx.target.networkKind || lease.context.target.canisterIds.pii_access_control !== authority) throw new Error("Invalid original private profile route.");
          const routeTarget = JSON.stringify(lease.context.target);
          routeGuards.set(authority, () => {
            active();
            if (lease.context.identity !== identity || JSON.stringify(lease.context.target) !== routeTarget) throw new Error("Original private profile route changed.");
          });
          return lease;
        })();
        leases.set(authority, pendingLease);
      }
      const lease = await pendingLease;
      const route = lease.context;
      const routeActive = () => {
        active();
        routeGuards.get(authority)?.();
      };
      options.onStep?.('ciphertext');
      const part = await boundedRead(route, subjects, routeActive, options.audience, options.onStep);
      if (options.audience && !partial && part.size !== subjects.length) throw new Error('Private-name audience is incomplete or unavailable.');
      active();
      const group = names.get(authority) ?? new Map<string, string>();
      for (const [id, name] of part) group.set(id, name);
      names.set(authority, group);
    } catch (error) {
      if (partial) { failures.set(authority, error); names.delete(authority); return; }
      if (options.audience) throw error; /* Display-only reads remain neutral. */
    }
  };
  try {
    for (let start = 0; start < jobs.length; start += 4) await Promise.all(jobs.slice(start, start + 4).map(readJob));
    for (const [authority, pendingLease] of leases) {
      try {
        const lease = await pendingLease;
        active(); routeGuards.get(authority)?.();
        options.onStep?.('closing');
        await boundedAuthorityCheck(lease.confirm,
          devTeam ? 'Private team-name route closing timed out.' : undefined, devTeam ? 20_000 : undefined);
        active(); routeGuards.get(authority)?.();
      } catch (error) {
        if (partial) failures.set(authority, error);
        else if (options.audience) throw error;
        names.delete(authority);
      }
    }
  } catch (error) {
    // A refused parallel batch retires sibling work before its late reply can
    // start fresh key derivations or contribute to a replacement request.
    retired = true;
    names.clear();
    throw error;
  }
  active();
  if (partial) {
    return profiles.map((profile, index) => {
      const ref = references[index];
      if (ref === undefined) return profile;
      const name = ref ? names.get(ref.authority)?.get(ref.subject) : undefined;
      if (name) return { ...profile, display_name: name };
      const failure = ref ? failures.get(ref.authority) : undefined;
      const name_error = ref === null ? 'Private-name reference does not match this member.'
        : failure !== undefined ? (failure instanceof Error ? failure.message : String(failure))
        : NAME_NOT_SHARED_YET;
      return { ...profile, display_name: null, name_error };
    });
  }
  if (options.audience && references.some(ref => ref === null || (ref && !names.get(ref.authority)?.has(ref.subject)))) throw new Error('Private-name authority is unverified or unavailable.');
  return profiles.map((profile, index) => {
    const ref = references[index];
    if (ref === undefined) return profile;
    const name = ref ? names.get(ref.authority)?.get(ref.subject) : undefined;
    return { ...profile, display_name: name ?? null };
  });
}
const ownClubNameBackfills = new Set<string>();

/** Best-effort, once per session per account: copy the caller's own unlocked
 * name to every club they belong to. Never blocks or throws. */
function scheduleOwnClubNameBackfill(ctx: FeatureBackendContext, caller: string, name: string): void {
  if (!privateClubNameDisplaysEnabled() && !devClubNameReleaseTarget(ctx.target) &&
      !(import.meta.env.IGNITE_LIVE_SHARED_CLUB_NAMES === '1' && ctx.target.provider === 'icp')) return;
  // In-flight rather than permanent account suppression: a later sign-in may
  // include a newly joined club. Source-qualified identity prevents Group 1
  // and Group 2 sessions from suppressing one another.
  const slot = `${ctx.target.host}|${ctx.target.canisterIds.pii_access_control}|${caller}`;
  if (ownClubNameBackfills.has(slot)) return;
  ownClubNameBackfills.add(slot);
  setTimeout(() => {
    void refreshPrivateOwnClubNames(ctx, name, async () => {
      const { getLiveMyRoleGrants } = await import('./features/membership');
      const grants = await getLiveMyRoleGrants(ctx);
      return grants.flatMap(grant => grant.club ?? []);
    }).catch(error => {
      console.warn('[profile] club name backfill skipped', error);
    }).finally(() => ownClubNameBackfills.delete(slot));
  }, 3000);
}
