import type { FeatureBackendContext } from '@/live/featureRouter';

/**
 * Read the exact group that owns this team, using club_domain Child.teams as
 * the authoritative roster source. No PII/name is returned by this method.
 * Keep the existing Events API only for pre-upgrade canisters that have not
 * published this new method; permission denials are never downgraded to [] or
 * bypassed by a fallback.
 */
export async function readTeamChildRows(ctx: FeatureBackendContext, clubId: string, teamId: string) {
  const { listLiveTeamChildIds } = await import('@/live/features/club');
  let childIds: string[];
  try {
    // A failed browser transport read can occur while opening a cold DEV group.
    // Retry exactly once only for transport errors, never for denied membership,
    // unrecognised methods or an identity/session failure.
    try {
      childIds = await listLiveTeamChildIds(ctx, clubId, teamId);
    } catch (first) {
      if (!isTransientTeamRosterTransportError(first)) throw first;
      childIds = await listLiveTeamChildIds(ctx, clubId, teamId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/has no (?:query|update) method|method not found|did not find method|unknown method/i.test(message)) throw error;
    // Transitional compatibility only. In Group 2, this legacy read currently
    // denies parents; do not misreport its result as a complete child roster.
    const [{ readContentInScope }, { listLiveChildTeamAssignments }] = await Promise.all([
      import('@/live/contentRouting'), import('@/live/features/events'),
    ]);
    const legacy = await readContentInScope(ctx, 'events', { clubId }, scoped =>
      listLiveChildTeamAssignments(scoped, clubId, teamId));
    childIds = legacy.map(row => row.child_id);
  }
  return childIds.map(id => ({ id, child_id: id,
    children: { id, name: 'Player', year_of_birth: null, parent_id: null, profiles: null, allParentNames: [] } }));
}

export function teamRoleRows(grants: readonly { account_id: string; role: string }[]) {
  return grants.map(grant => {
    const userId = grant.account_id.replace(/^principal:/, '');
    return { id: `${userId}:${grant.role}`, user_id: userId, role: grant.role, profiles: null };
  });
}
/** Error classifications contain no child IDs, profile data or raw canister replies. */
export function teamRosterReadFailureCode(error: unknown): 'SESSION' | 'PERMISSION' | 'TIMEOUT' | 'TRANSPORT' | 'ROUTING' | 'OTHER' {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/session|identity.*(?:expired|changed|required)|sign.?in|unauthenticated|delegation/i.test(message)) return 'SESSION';
  if (/forbidden|permission|unauthori[sz]ed|membership required|not allowed|access denied/i.test(message)) return 'PERMISSION';
  if (/timed out|timeout|deadline|took too long/i.test(message)) return 'TIMEOUT';
  if (isTransientTeamRosterTransportError(error)) return 'TRANSPORT';
  if (/routing|placement|canister.*(?:not configured|not found)|unknown method|method not found/i.test(message)) return 'ROUTING';
  return 'OTHER';
}

function isTransientTeamRosterTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|network (?:error|request failed)|connection (?:reset|closed)|temporarily unavailable|http 50[234]/i.test(message);
}
