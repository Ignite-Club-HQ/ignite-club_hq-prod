import type { FeatureBackendContext } from "@/live/featureRouter";
import { getLiveMyRoleGrants } from "@/live/features/membership";
import { getLiveTeam, getLiveClubProfile } from "@/live/features/club";
import { listMyLiveMiniLeagues, listLiveMiniLeaguesByClub, getLiveMiniLeague } from "@/live/features/miniLeagues";

export interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  club_logo_url: string | null;
  type: "team" | "league" | "competition";
  club_name: string;
  sport: string | null;
  club_id: string;
  canManage: boolean;
  isOnTrial?: boolean;
  /** For competition cards: comma-separated list of the user's teams entered */
  competitionTeamsLabel?: string;
}


export async function fetchIcpCarouselItems(
  ctx: FeatureBackendContext,
  activeClubFilter: string | null,
): Promise<TeamOrLeague[]> {
  const grants = (await getLiveMyRoleGrants(ctx)) as unknown as {
    club: [] | [string];
    team: [] | [string];
    role: string;
  }[];
  const teamIds = [...new Set(grants.filter((g) => g.team[0]).map((g) => g.team[0]!))];
  const leagueAdminClubIds = [...new Set(
    grants.filter((g) => g.club[0] && g.role === "league_admin").map((g) => g.club[0]!),
  )];

  const clubMeta = new Map<string, { name: string; logo_url: string | null; sport: string | null }>();
  const getClubMeta = async (clubId: string) => {
    let meta = clubMeta.get(clubId);
    if (!meta) {
      try {
        const opt = (await getLiveClubProfile(ctx, clubId)) as any;
        const p = Array.isArray(opt) ? opt[0] : opt;
        meta = { name: p?.name ?? "", logo_url: p?.logo_url?.[0] ?? null, sport: p?.sport ?? null };
      } catch {
        meta = { name: "", logo_url: null, sport: null };
      }
      clubMeta.set(clubId, meta);
    }
    return meta;
  };

  const result: TeamOrLeague[] = [];

  await Promise.all(
    teamIds.map(async (teamId) => {
      try {
        const raw = (await getLiveTeam(ctx, teamId)) as any;
        const team = Array.isArray(raw) ? raw[0] : raw;
        if (!team || team.archived || team.deleted_at_ms?.length) return;
        if (activeClubFilter && team.club_id !== activeClubFilter) return;
        const teamRoles = grants.filter((g) => g.team[0] === teamId);
        const clubRoles = grants.filter((g) => g.club[0] === team.club_id);
        const canManage =
          teamRoles.some((g) => ["coach", "team_admin"].includes(g.role)) ||
          clubRoles.some((g) => ["club_admin", "app_admin"].includes(g.role));
        const meta = await getClubMeta(team.club_id);
        let isOnTrial = false;
        try {
          const { getLiveTeamSubscription } = await import("@/live/features/club");
          const sub = await getLiveTeamSubscription(ctx, team.id);
          isOnTrial = !!(sub?.is_pro && sub?.trial_ends_at_ms);
        } catch { /* subscription row absent — not on trial */ }
        result.push({
          id: team.id,
          name: team.name,
          logo_url: team.logo_url?.[0] ?? null,
          club_logo_url: meta.logo_url,
          type: "team",
          club_name: meta.name,
          sport: meta.sport,
          club_id: team.club_id,
          canManage,
          isOnTrial,
        });
      } catch (error) {
        // Absence is the successful null row above. A failed resumed request
        // must not certify an empty inventory or discard existing cards.
        throw error;
      }
    }),
  );

  const leagueIds = new Set<string>();
  try {
    const mine = (await listMyLiveMiniLeagues(ctx)) as any[];
    for (const l of mine || []) if (l?.id) leagueIds.add(l.id);
  } catch (error) { throw error; }
  await Promise.all(
    leagueAdminClubIds.map(async (clubId) => {
      try {
        const ls = (await listLiveMiniLeaguesByClub(ctx, clubId)) as any[];
        for (const l of ls || []) if (l?.id) leagueIds.add(l.id);
      } catch (error) { throw error; }
    }),
  );
  await Promise.all(
    [...leagueIds].map(async (leagueId) => {
      try {
        const raw = (await getLiveMiniLeague(ctx, leagueId)) as any;
        const league = Array.isArray(raw) ? raw[0] : raw;
        if (!league || league.status === "deleted" || league.status === "archived") return;
        if (activeClubFilter && league.club_id !== activeClubFilter) return;
        const meta = await getClubMeta(league.club_id);
        result.push({
          id: league.id,
          name: league.name,
          logo_url: league.logo_url?.[0] ?? null,
          club_logo_url: meta.logo_url,
          type: "league",
          club_name: meta.name,
          sport: meta.sport,
          club_id: league.club_id,
          canManage: leagueAdminClubIds.includes(league.club_id),
        });
      } catch (error) { throw error; }
    }),
  );

  return result.sort((a, b) => {
    if (a.canManage && !b.canManage) return -1;
    if (!a.canManage && b.canManage) return 1;
    if (a.type === "team" && b.type === "league") return -1;
    if (a.type === "league" && b.type === "team") return 1;
    return a.name.localeCompare(b.name);
  });
}

