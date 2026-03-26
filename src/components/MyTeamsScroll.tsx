import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users } from "lucide-react";
import { getCachedTeam, cacheTeams } from "@/lib/clubTeamCache";

interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  type: "team" | "league";
  club_name: string;
  sport: string | null;
}

export function MyTeamsScroll() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-teams-leagues-scroll", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user) return [];

      // Get user's roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user.id);

      if (!roles) return [];

      const teamIds = [...new Set(roles.filter(r => r.team_id).map(r => r.team_id))] as string[];
      const clubIds = [...new Set(roles.filter(r => r.club_id).map(r => r.club_id))] as string[];

      const result: TeamOrLeague[] = [];

      // Fetch teams
      if (teamIds.length > 0) {
        // Check cache first
        const uncachedIds: string[] = [];
        const cachedTeams: TeamOrLeague[] = [];
        
        for (const id of teamIds) {
          const cached = getCachedTeam(id);
          if (cached) {
            // We still need club_name, so fetch anyway if not filtered
            uncachedIds.push(id);
          } else {
            uncachedIds.push(id);
          }
        }

        const { data: teams } = await supabase
          .from("teams")
          .select("id, name, logo_url, club_id, clubs(name, sport)")
          .in("id", teamIds);

        if (teams) {
          // Cache the teams
          cacheTeams(teams.map(t => ({
            id: t.id,
            name: t.name,
            logo_url: t.logo_url,
            club_id: t.club_id,
            level_age: null,
          })));

          for (const team of teams) {
            if (activeClubFilter && team.club_id !== activeClubFilter) continue;
            result.push({
              id: team.id,
              name: team.name,
              logo_url: team.logo_url,
              type: "team",
              club_name: team.clubs?.name || "",
              sport: team.clubs?.sport || null,
            });
          }
        }
      }

      // Fetch mini leagues user is part of (as parent or admin)
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user.id);

      const leagueIds = new Set(playerLeagues?.map(p => p.mini_league_id) || []);

      // Also add leagues from league_admin roles
      const leagueAdminClubIds = roles
        .filter(r => r.club_id && (r.role === "league_admin" || r.role === "club_admin"))
        .map(r => r.club_id) as string[];

      if (leagueAdminClubIds.length > 0) {
        const { data: adminLeagues } = await supabase
          .from("mini_leagues")
          .select("id")
          .in("club_id", leagueAdminClubIds);
        adminLeagues?.forEach(l => leagueIds.add(l.id));
      }

      if (leagueIds.size > 0) {
        const { data: leagues } = await supabase
          .from("mini_leagues")
          .select("id, name, club_id, clubs(name, sport)")
          .in("id", Array.from(leagueIds));

        if (leagues) {
          for (const league of leagues) {
            if (activeClubFilter && league.club_id !== activeClubFilter) continue;
            result.push({
              id: league.id,
              name: league.name,
              logo_url: null,
              type: "league",
              club_name: league.clubs?.name || "",
              sport: league.clubs?.sport || null,
            });
          }
        }
      }

      // Sort alphabetically
      return result.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {[1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-[120px] h-[72px] rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">My Teams</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {items.map((item) => (
          <button
            key={`${item.type}-${item.id}`}
            onClick={() => {
              if (item.type === "team") {
                navigate(`/teams/${item.id}`);
              } else {
                navigate(`/leagues/${item.id}`);
              }
            }}
            className="shrink-0 w-[120px] rounded-lg border bg-card p-3 flex flex-col items-center gap-1.5 hover:border-primary/50 transition-colors active:scale-[0.97]"
          >
            {item.logo_url ? (
              <img
                src={item.logo_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <span className="text-xs font-medium text-center w-full truncate">{item.name}</span>
            {item.type === "league" && (
              <span className="text-[10px] text-muted-foreground">League</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
