import type { FeatureBackendContext } from "@/live/featureRouter";
import { getLiveMyRoleGrants } from "@/live/features/membership";
import { getLiveTeam, getLiveClubProfile, getLiveTeamSubscription } from "@/live/features/club";
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
  onProgress?: (items: TeamOrLeague[]) => void,
): Promise<TeamOrLeague[]> {
  const grants = (await getLiveMyRoleGrants(ctx)) as unknown as {
    club: [] | [string];
    team: [] | [string];
    role: string;
  }[];
  const teamIds = [...new Set(grants.flatMap((g) => g.team))];
  const leagueAdminClubIds = [...new Set(
    grants.flatMap((g) => g.role === "league_admin" ? g.club : []),
  )];

  type ClubMeta = { name: string; logo_url: string | null; sport: string | null };
  const clubMeta = new Map<string, Promise<ClubMeta>>();
  const getClubMeta = (clubId: string): Promise<ClubMeta> => {
    const existing = clubMeta.get(clubId);
    if (existing) return existing;
    const pending = getLiveClubProfile(ctx, clubId).then(([p]) => ({
      name: p?.name ?? "", logo_url: p?.logo_url[0] ?? null, sport: p?.sport ?? null,
    }), () => ({ name: "", logo_url: null, sport: null }));
    clubMeta.set(clubId, pending);
    return pending;
  };

  const result: TeamOrLeague[] = [];

  const teams = Promise.all(
    teamIds.map(async (teamId) => {
      try {
        // The trial flag only depends on the team id, so read it alongside the
        // team row (both coalesce into one get_teams / get_team_subscriptions
        // call). The result is discarded unless the team itself is visible.
        const subRead = getLiveTeamSubscription(ctx, teamId).catch(() => null);
        // Team grants usually carry their club id: warm that club's profile in
        // the same round trip. It is only used if the team row confirms it.
        for (const g of grants) if (g.team[0] === teamId && g.club[0]) void getClubMeta(g.club[0]);
        const raw = (await getLiveTeam(ctx, teamId)) as any;
        const team = Array.isArray(raw) ? raw[0] : raw;
        if (!team || team.archived || team.deleted_at_ms?.length) return;
        if (activeClubFilter && team.club_id !== activeClubFilter) return;
        const teamRoles = grants.filter((g) => g.team[0] === teamId);
        const clubRoles = grants.filter((g) => g.club[0] === team.club_id);
        const canManage =
          teamRoles.some((g) => ["coach", "team_admin"].includes(g.role)) ||
          clubRoles.some((g) => ["club_admin", "app_admin"].includes(g.role));
        // Only the authorized team row and grants are required for navigation.
        // Brand metadata/trial badges arrive later without extra requests.
        const card: TeamOrLeague = {
          id: team.id,
          name: team.name,
          logo_url: team.logo_url?.[0] ?? null,
          club_logo_url: null,
          type: "team",
          club_name: "",
          sport: null,
          club_id: team.club_id,
          canManage,
        };
        result.push(card);
        onProgress?.(result.map(item => ({ ...item })));
        const [meta, sub] = await Promise.all([getClubMeta(team.club_id), subRead]);
        Object.assign(card, { club_logo_url: meta.logo_url, club_name: meta.name,
          sport: meta.sport, isOnTrial: !!(sub?.is_pro && sub?.trial_ends_at_ms) });
        onProgress?.(result.map(item => ({ ...item })));
      } catch (error) {
        // Absence is the successful null row above. A failed resumed request
        // must not certify an empty inventory or discard existing cards.
        throw error;
      }
    }),
  );

  const leagues = (async () => {
  const leagueIds = new Set<string>();
  const [mine, byClub] = await Promise.all([
    listMyLiveMiniLeagues(ctx),
    Promise.all(leagueAdminClubIds.map(id => listLiveMiniLeaguesByClub(ctx, id))),
  ]);
  for (const league of [...mine, ...byClub.flat()]) leagueIds.add(league.id);
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
        onProgress?.(result.map(item => ({ ...item })));
      } catch (error) { throw error; }
    }),
  );

  })();
  // Failed inventories still reject; never certify an empty carousel.
  await Promise.all([teams, leagues]);

  return result.sort((a, b) => {
    if (a.canManage && !b.canManage) return -1;
    if (!a.canManage && b.canManage) return 1;
    if (a.type === "team" && b.type === "league") return -1;
    if (a.type === "league" && b.type === "team") return 1;
    return a.name.localeCompare(b.name);
  });
}

