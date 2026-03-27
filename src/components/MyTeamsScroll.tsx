import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users, Calendar, MessageCircle } from "lucide-react";
import { getCachedTeam, cacheTeams } from "@/lib/clubTeamCache";
import { format, isToday, isTomorrow, parseISO } from "date-fns";

interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  type: "team" | "league";
  club_name: string;
  sport: string | null;
}

interface NextEventInfo {
  title: string;
  dateLabel: string;
}

function formatShortDate(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today ${format(date, "h:mma").toLowerCase()}`;
  if (isTomorrow(date)) return `Tmrw ${format(date, "h:mma").toLowerCase()}`;
  return `${format(date, "EEE")} ${format(date, "h:mma").toLowerCase()}`;
}

export function MyTeamsScroll() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-teams-leagues-scroll", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user) return [];

      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user.id);

      if (!roles) return [];

      const teamIds = [...new Set(roles.filter(r => r.team_id).map(r => r.team_id))] as string[];
      const clubIds = [...new Set(roles.filter(r => r.club_id).map(r => r.club_id))] as string[];

      const result: TeamOrLeague[] = [];

      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("id, name, logo_url, club_id, clubs(name, sport)")
          .in("id", teamIds);

        if (teams) {
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

      // Fetch mini leagues
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user.id);

      const leagueIds = new Set(playerLeagues?.map(p => p.mini_league_id) || []);

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

      return result.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch next event per team
  const teamIds = items.filter(i => i.type === "team").map(i => i.id);
  const leagueIds = items.filter(i => i.type === "league").map(i => i.id);

  const { data: nextEvents = {} } = useQuery({
    queryKey: ["team-next-events", teamIds, leagueIds],
    queryFn: async () => {
      const now = new Date().toISOString();
      const map: Record<string, NextEventInfo> = {};

      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("team_id, title, type, event_date")
          .in("team_id", teamIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.team_id && !map[event.team_id]) {
              const typeLabel = event.type === "game" ? "Game" : event.type === "training" ? "Training" : "Social";
              map[event.team_id] = {
                title: typeLabel,
                dateLabel: formatShortDate(event.event_date),
              };
            }
          }
        }
      }

      if (leagueIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("mini_league_id, title, type, event_date")
          .in("mini_league_id", leagueIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.mini_league_id && !map[event.mini_league_id]) {
              const typeLabel = event.type === "game" ? "Game" : event.type === "training" ? "Training" : "Event";
              map[event.mini_league_id] = {
                title: typeLabel,
                dateLabel: formatShortDate(event.event_date),
              };
            }
          }
        }
      }

      return map;
    },
    enabled: items.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch unread message counts per team
  const { data: unreadCounts = {} } = useQuery({
    queryKey: ["team-unread-counts", user?.id, teamIds],
    queryFn: async () => {
      if (!user || teamIds.length === 0) return {};
      const map: Record<string, number> = {};

      // Get last read timestamps from chat_read_receipts for team chats
      const { data: receipts } = await supabase
        .from("chat_read_receipts")
        .select("chat_id, last_read_at")
        .eq("user_id", user.id)
        .eq("chat_type", "team");

      const receiptMap: Record<string, string> = {};
      receipts?.forEach(r => { receiptMap[r.chat_id] = r.last_read_at; });

      // For each team, count messages after last read
      for (const teamId of teamIds) {
        const lastRead = receiptMap[teamId];
        let query = supabase
          .from("team_messages")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId)
          .neq("author_id", user.id)
          .is("deleted_at", null);

        if (lastRead) {
          query = query.gt("created_at", lastRead);
        }

        const { count } = await query;
        if (count && count > 0) {
          map[teamId] = count;
        }
      }

      return map;
    },
    enabled: !!user && teamIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {[1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-[140px] h-[100px] rounded-lg bg-muted animate-pulse" />
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
        {items.map((item) => {
          const nextEvent = nextEvents[item.id];
          const unread = unreadCounts[item.id] || 0;

          return (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => {
                if (item.type === "team") {
                  navigate(`/teams/${item.id}`);
                } else {
                  navigate(`/mini-leagues/${item.id}`);
                }
              }}
              className="shrink-0 w-[140px] rounded-lg border bg-card p-3 flex flex-col items-center gap-1.5 hover:border-primary/50 transition-colors active:scale-[0.97] relative"
            >
              {/* Unread badge */}
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}

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

              {/* Contextual info */}
              {nextEvent ? (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground w-full justify-center">
                  <Calendar className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{nextEvent.title} {nextEvent.dateLabel}</span>
                </span>
              ) : item.type === "league" ? (
                <span className="text-[10px] text-muted-foreground">League</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">No upcoming</span>
              )}

              {/* Unread messages text indicator */}
              {unread > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                  <MessageCircle className="h-2.5 w-2.5" />
                  {unread} new
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
