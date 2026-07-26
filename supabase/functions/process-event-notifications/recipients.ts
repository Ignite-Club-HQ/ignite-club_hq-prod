/**
 * Recipient resolution for event fan-out. Extracted verbatim from
 * `index.ts` so it can be characterization-tested with a fake Supabase
 * client. Behaviour MUST stay byte-for-byte identical — the audience of
 * team / mini-league / club-wide / targeted events is a safety-critical
 * contract (see docs/PROMOTION_CHECKLIST.md).
 */

// Resolve recipients for team/club/mini-league scoped events
export async function resolveRecipients(
  supabase: any,
  eventId: string,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null,
  excludeUserId: string,
): Promise<string[]> {
  if (miniLeagueId) {
    // Mini-league events route ONLY to league members:
    // - parents/player-users in this mini_league
    // - mini_league_admins for this league
    // - league_admin role-holders for this club
    // Club-wide coaches/club_admins are intentionally excluded.
    const [playersResult, leagueAdminResult, roleAdminResult] = await Promise.all([
      supabase
        .from('mini_league_players')
        .select('parent_user_id')
        .eq('mini_league_id', miniLeagueId)
        .not('parent_user_id', 'is', null),
      supabase
        .from('mini_league_admins')
        .select('user_id')
        .eq('mini_league_id', miniLeagueId),
      supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'league_admin')
        .eq('club_id', clubId),
    ]);
    const parentIds = (playersResult.data || []).map((p: any) => p.parent_user_id);
    const leagueAdminIds = (leagueAdminResult.data || []).map((a: any) => a.user_id);
    const roleAdminIds = (roleAdminResult.data || []).map((a: any) => a.user_id);
    return [...new Set([...parentIds, ...leagueAdminIds, ...roleAdminIds])].filter(id => id !== excludeUserId);
  }

  // Paginate every branch deterministically. PostgREST has a per-request row cap
  // (project-configured, observed < 409 on this project) that silently truncates
  // un-ordered .range() queries — see Kings Cup fan-out incident where 8 club
  // members were silently dropped. Keep PAGE_SIZE well below any plausible cap.
  const PAGE_SIZE = 200;

  async function paginateUserIds(
    build: () => any,
  ): Promise<string[]> {
    let offset = 0;
    const ids: string[] = [];
    while (true) {
      const { data: page, error } = await build()
        .order('user_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.error('[EVENT-NOTIFY] Recipient pagination error:', error);
        break;
      }
      const rows = page || [];
      if (rows.length === 0) break;
      ids.push(...rows.map((m: any) => m.user_id));
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return ids;
  }

  if (teamId) {
    const ids = await paginateUserIds(() =>
      supabase
        .from('user_roles')
        .select('user_id')
        .eq('team_id', teamId)
        .neq('user_id', excludeUserId)
    );
    return [...new Set(ids)];
  }

  // Club-wide. If the event is role-restricted, only invite those roles plus club admins.
  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('restricted_to_roles, target_team_ids')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) {
    console.error('[EVENT-NOTIFY] Restricted-role lookup error:', eventError);
  }
  const restrictedRoles = Array.isArray(eventRow?.restricted_to_roles)
    ? eventRow.restricted_to_roles
    : [];
  const rolesToInvite = restrictedRoles.length > 0
    ? [...new Set([...restrictedRoles, 'club_admin'])]
    : null;

  // Targeted club-wide events: only fan out to members/coaches/team_admins
  // of the targeted teams, guardians of children assigned to them, plus
  // club-level admins/committee. Non-targeted same-club members are excluded.
  const targetTeamIds: string[] = Array.isArray(eventRow?.target_team_ids)
    ? eventRow.target_team_ids
    : [];
  if (targetTeamIds.length > 0) {
    const [teamRoleIds, adminIds, guardianIds] = await Promise.all([
      paginateUserIds(() =>
        supabase
          .from('user_roles')
          .select('user_id')
          .in('team_id', targetTeamIds)
          .neq('user_id', excludeUserId),
      ),
      paginateUserIds(() =>
        supabase
          .from('user_roles')
          .select('user_id')
          .eq('club_id', clubId)
          .in('role', ['club_admin', 'committee_member'])
          .neq('user_id', excludeUserId),
      ),
      (async () => {
        // Guardians of children assigned to any targeted team.
        const { data: assigns, error } = await supabase
          .from('child_team_assignments')
          .select('child_id')
          .in('team_id', targetTeamIds);
        if (error || !assigns?.length) return [] as string[];
        const childIds = [...new Set(assigns.map((a: any) => a.child_id))];
        const out: string[] = [];
        // Chunk to keep .in() list reasonable.
        for (let i = 0; i < childIds.length; i += 200) {
          const chunk = childIds.slice(i, i + 200);
          const { data: guardians } = await supabase
            .from('child_guardians')
            .select('guardian_id')
            .in('child_id', chunk);
          if (guardians) out.push(...guardians.map((g: any) => g.guardian_id));
        }
        return out.filter((id) => id && id !== excludeUserId);
      })(),
    ]);
    return [...new Set([...teamRoleIds, ...adminIds, ...guardianIds])];
  }

  const ids = await paginateUserIds(() => {
    let query = supabase
      .from('user_roles')
      .select('user_id')
      .eq('club_id', clubId)
      .neq('user_id', excludeUserId);
    if (rolesToInvite) query = query.in('role', rolesToInvite);
    return query;
  });
  return [...new Set(ids)];
}
