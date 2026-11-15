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
    childIds = await listLiveTeamChildIds(ctx, clubId, teamId);
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