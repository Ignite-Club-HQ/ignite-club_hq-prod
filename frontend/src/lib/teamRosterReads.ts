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
export type TeamRosterFailureCode = 'SESSION' | 'PERMISSION' | 'TIMEOUT' | 'TRANSPORT' | 'ROUTING' | 'OTHER' | 'ROUTE_OPEN_TIMEOUT' | 'ROUTE_CLOSE_TIMEOUT' | 'CIPHERTEXT_TIMEOUT' | 'VETKEY_TIMEOUT' | 'ROSTER_TIMEOUT' | 'DECRYPT_TIMEOUT'
  | 'NOT_SHARED_YET' | 'SERVICE_NOT_ADMITTED' | 'PROFILE_LINK_MISMATCH' | 'RELEASE_NOT_CONFIGURED' | 'SOURCE_ROUTE_CHANGED';

/** Fixed, non-sensitive server/client refusal texts for parent names. */
const KNOWN_NAME_FAILURES: ReadonlyArray<[RegExp, TeamRosterFailureCode]> = [
  [/^Club name copy not saved yet\.$/, 'NOT_SHARED_YET'],
  [/Configured private-name service required|DEV G2 private-name service authority changed/, 'SERVICE_NOT_ADMITTED'],
  [/Original private-name binding changed|Private-name reference does not match this member/, 'PROFILE_LINK_MISMATCH'],
  [/Private-name release fenced or not configured|Private name audiences are not released/, 'RELEASE_NOT_CONFIGURED'],
  [/Original DEV source or registered team authority changed|Foreign original PII canister|DEV team-name routing authority changed/, 'SOURCE_ROUTE_CHANGED'],
];

export function teamRosterReadFailureCode(error: unknown): TeamRosterFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  for (const [pattern, code] of KNOWN_NAME_FAILURES) if (pattern.test(message)) return code;
  // Only locally authored, non-sensitive DEV team-name stage errors receive
  // precise labels; never echo arbitrary backend exception text or IDs.
  if (message === 'Private team-name route opening timed out.') return 'ROUTE_OPEN_TIMEOUT';
  if (message === 'Private team-name route closing timed out.') return 'ROUTE_CLOSE_TIMEOUT';
  if (message === 'Private team-name ciphertext timed out.') return 'CIPHERTEXT_TIMEOUT';
  if (message === 'Private team-name vetkey timed out.') return 'VETKEY_TIMEOUT';
  if (message === 'Private team-name decrypt timed out.' || message === 'Private team-name confirm timed out.') return 'DECRYPT_TIMEOUT';
  if (message === 'The member names took too long to load. Please try again.') return 'ROSTER_TIMEOUT';
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

const ADULT_NAME_ISSUE_LABELS: Partial<Record<TeamRosterFailureCode, string>> = {
  NOT_SHARED_YET: 'not shared with this club yet — they need to open the app once while signed in',
  SERVICE_NOT_ADMITTED: 'their name service is not yet accepted by the sign-in service (backend update pending)',
  PROFILE_LINK_MISMATCH: 'their sign-in is linked to a different profile record (account link needs repair)',
  RELEASE_NOT_CONFIGURED: 'club name sharing is switched off on their name service',
  SOURCE_ROUTE_CHANGED: 'their name service location could not be verified',
  TIMEOUT: 'took too long to load — try Retry names',
  TRANSPORT: 'network problem — try Retry names',
  PERMISSION: 'access refused by the club',
};

export function adultNameIssueLabel(code: TeamRosterFailureCode): string {
  return ADULT_NAME_ISSUE_LABELS[code] ?? `could not be loaded (${code})`;
}

export function summarizeAdultNameIssues(messages: readonly string[]): Array<{ code: TeamRosterFailureCode; count: number }> {
  const counts = new Map<TeamRosterFailureCode, number>();
  for (const message of messages) {
    const code = teamRosterReadFailureCode(message);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}
