import { useQuery } from "@tanstack/react-query";
import { LogoImage } from "@/components/ui/logo-image";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users, Calendar, Image, ChevronRight } from "lucide-react";
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
  label: string;
  dateLabel: string;
}

interface PhotoThumb {
  id: string;
  team_id: string;
  image_url: string | null;
  file_url: string | null;
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
    retry: 3,
    queryFn: async () => {
      if (!user) return [];

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user.id);

      if (rolesError) throw rolesError;
      if (!roles) return [];

      const teamIds = [...new Set(roles.filter(r => r.team_id).map(r => r.team_id))] as string[];

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
    placeholderData: (prev) => prev,
  });

  // Fetch next event per team/league
  const teamIds = items.filter(i => i.type === "team").map(i => i.id);
  const leagueIds = items.filter(i => i.type === "league").map(i => i.id);

  const { data: nextEvents = {} } = useQuery({
    queryKey: ["team-next-events", teamIds, leagueIds],
    queryFn: async () => {
      const now = new Date().toISOString();
      const map: Record<string, NextEventInfo> = {};

      const extractOpponent = (title: string): string | null => {
        const m = title.match(/\s+vs?\.?\s+(.+)$/i);
        return m ? m[1].trim() : null;
      };
      const buildLabel = (type: string | null, opponent: string | null, title: string, isBye: boolean) => {
        if (type === "training") return "Training";
        if (type === "social") return "Social";
        if ((type === "game" || type === "mini_league") && isBye) return "BYE — no match";
        const opp = opponent || extractOpponent(title);
        if ((type === "game" || type === "mini_league") && opp) return `Game v ${opp}`;
        if (type === "game" || type === "mini_league") return "Game";
        return title;
      };

      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("team_id, title, type, opponent, event_date, is_bye")
          .in("team_id", teamIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.team_id && !map[event.team_id]) {
              map[event.team_id] = {
                label: buildLabel(event.type, event.opponent, event.title, !!(event as any).is_bye),
                dateLabel: formatShortDate(event.event_date),
              };
            }
          }
        }
      }

      if (leagueIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("mini_league_id, title, type, opponent, event_date, is_bye")
          .in("mini_league_id", leagueIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.mini_league_id && !map[event.mini_league_id]) {
              map[event.mini_league_id] = {
                label: buildLabel(event.type, event.opponent, event.title, !!(event as any).is_bye),
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

  // Fetch latest photos for all teams (up to 3 per team)
  const { data: photoMap = {} } = useQuery({
    queryKey: ["my-teams-photos", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {};
      const { data } = await supabase
        .from("photos")
        .select("id, team_id, image_url, file_url")
        .in("team_id", teamIds)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(teamIds.length * 3);

      const map: Record<string, PhotoThumb[]> = {};
      for (const photo of (data || [])) {
        if (!map[photo.team_id]) map[photo.team_id] = [];
        if (map[photo.team_id].length < 3) {
          map[photo.team_id].push(photo);
        }
      }
      return map;
    },
    enabled: teamIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {[1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-[140px] h-[96px] rounded-lg bg-muted animate-pulse" />
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
          const photos = item.type === "team" ? (photoMap[item.id] || []) : [];
          const hasPhotos = photos.length > 0;
          const isTeam = item.type === "team";

          const openPrimary = () => {
            if (isTeam) navigate(`/teams/${item.id}`);
            else navigate(`/mini-leagues/${item.id}`);
          };
          const openGallery = () => navigate(`/media?team=${item.id}`);

          return (
            <div
              key={`${item.type}-${item.id}`}
              className="shrink-0 w-[180px] rounded-lg border bg-card flex flex-col overflow-hidden select-none"
            >
              {/* Team area — primary tap target */}
              <button
                type="button"
                onClick={openPrimary}
                className="flex flex-col items-center gap-1.5 px-3 pt-3 pb-2.5 hover:bg-muted/30 active:bg-muted/60 transition-colors text-left w-full"
              >
                {item.logo_url ? (
                  <LogoImage
                    src={item.logo_url}
                    className="h-8 w-8 rounded-full object-cover"
                    fallback={
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                        <Users className="h-4 w-4 text-muted-foreground" />
                      </div>
                    }
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <span className="text-xs font-medium text-center w-full truncate">{item.name}</span>

                {nextEvent ? (
                  <div className="flex flex-col items-center gap-0.5 w-full">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground w-full justify-center min-w-0">
                      <Calendar className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{nextEvent.label}</span>
                    </span>
                    <span className="text-[10px] font-medium text-foreground/80">{nextEvent.dateLabel}</span>
                  </div>
                ) : item.type === "league" ? (
                  <span className="text-[10px] text-muted-foreground">League</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">No upcoming</span>
                )}
              </button>

              {/* Divider + Gallery area — secondary tap target (teams only) */}
              {isTeam && (
                <>
                  <div className="h-px bg-border/60 mx-3" />
                  <button
                    type="button"
                    onClick={openGallery}
                    className="group flex items-center gap-2 px-3 py-2 transition-colors w-full hover:bg-muted/30 active:bg-muted/50"
                  >
                    {hasPhotos ? (
                      <div className="flex -space-x-1.5 shrink-0">
                        {photos.map((photo) => {
                          const src = photo.image_url || photo.file_url;
                          return (
                            <div
                              key={photo.id}
                              className="relative h-5 w-5 rounded-sm overflow-hidden border-2 border-card ring-1 ring-border/30"
                            >
                              {src ? (
                                <img
                                  src={src}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full bg-muted flex items-center justify-center">
                                  <Image className="h-2.5 w-2.5 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <Image className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                    )}
                    <span className="text-[10px] text-muted-foreground/80 font-medium leading-none flex-1 text-left truncate">
                      {hasPhotos
                        ? `View ${photos.length} new ${photos.length === 1 ? "photo" : "photos"}`
                        : "Team Gallery"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 transition-all duration-200 group-hover:text-muted-foreground/70 group-hover:translate-x-0.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
