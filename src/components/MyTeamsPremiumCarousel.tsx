import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users, Calendar, Trophy, Plus, ChevronRight, MoreVertical, Image } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cacheTeams } from "@/lib/clubTeamCache";
import { format, isToday, isTomorrow, parseISO } from "date-fns";

interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  type: "team" | "league";
  club_name: string;
  sport: string | null;
  club_id: string;
  canManage: boolean;
}

interface NextEventInfo {
  title: string;
  dateLabel: string;
  type: string;
}

function formatShortDate(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today ${format(date, "h:mma").toLowerCase()}`;
  if (isTomorrow(date)) return `Tmrw ${format(date, "h:mma").toLowerCase()}`;
  return `${format(date, "EEE")} ${format(date, "h:mma").toLowerCase()}`;
}

const eventAccentColors: Record<string, string> = {
  game: "border-l-destructive",
  training: "border-l-primary",
  social: "border-l-warning",
};

const eventDotColors: Record<string, string> = {
  game: "bg-destructive",
  training: "bg-primary",
  social: "bg-warning",
};

function TeamCard({ item, nextEvent, photos }: { 
  item: TeamOrLeague; 
  nextEvent?: NextEventInfo;
  photos: string[];
}) {
  const navigate = useNavigate();

  const hasActivity = !!nextEvent || photos.length > 0;
  const accentBorder = nextEvent ? (eventAccentColors[nextEvent.type] || "border-l-primary") : "";

  return (
    <Card
      className={`shrink-0 w-[82vw] max-w-[320px] cursor-pointer border bg-card transition-all snap-start overflow-hidden ${
        hasActivity 
          ? `border-l-[3px] ${accentBorder} shadow-md hover:shadow-lg` 
          : "hover:border-primary/40 shadow-sm hover:shadow-md opacity-80"
      }`}
      role="button"
      tabIndex={0}
      aria-label={`${item.name} — ${item.club_name}`}
      onClick={() => {
        if (item.type === "team") {
          navigate(`/teams/${item.id}`);
        } else {
          navigate(`/mini-leagues/${item.id}`);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(item.type === "team" ? `/teams/${item.id}` : `/mini-leagues/${item.id}`);
        }
      }}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: avatar + name + menu */}
        <div className="flex items-center gap-3">
          {item.logo_url ? (
            <img
              src={item.logo_url}
              alt=""
              className="h-10 w-10 rounded-full object-cover shrink-0 ring-2 ring-primary/20"
            />
          ) : (
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
              item.type === "league" 
                ? "bg-accent/60 ring-2 ring-accent" 
                : "bg-primary/10 ring-2 ring-primary/20"
            }`}>
              {item.type === "league" ? (
                <Trophy className="h-5 w-5 text-accent-foreground" />
              ) : (
                <Users className="h-5 w-5 text-primary" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-[15px] leading-tight truncate">{item.name}</h3>
            <p className="text-[11px] text-muted-foreground truncate">{item.club_name}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Activity indicator dot */}
            {hasActivity && nextEvent && (
              <div className={`h-2 w-2 rounded-full ${eventDotColors[nextEvent.type] || "bg-primary"}`} />
            )}
            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-muted/80 active:bg-muted transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Team actions"
                >
                  <MoreVertical className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => navigate("/events")}>
                  <Calendar className="h-4 w-4 mr-2" />
                  View schedule
                </DropdownMenuItem>
                {item.canManage && (
                  <DropdownMenuItem onClick={() => navigate("/events/new")}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add event
                  </DropdownMenuItem>
                )}
                {photos.length > 0 && (
                  <DropdownMenuItem onClick={() => navigate(`/media?team=${item.id}`)}>
                    <Image className="h-4 w-4 mr-2" />
                    View photos
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Status area */}
        <div className="space-y-1.5">
          {nextEvent ? (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
              <span className="font-medium text-foreground truncate">
                {nextEvent.title}
              </span>
              <span className="text-muted-foreground text-xs shrink-0">
                {nextEvent.dateLabel}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No upcoming events</p>
          )}
        </div>

        {/* Photo thumbnails — non-interactive, just visual */}
        {photos.length > 0 && (
          <div className="flex gap-1.5">
            {photos.slice(0, 2).map((url, i) => (
              <div
                key={i}
                className="h-12 w-16 rounded-md overflow-hidden bg-muted"
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MyTeamsPremiumCarouselProps {
  onJoinTeam?: () => void;
  onCreateTeam?: () => void;
}

export function MyTeamsPremiumCarousel({ onJoinTeam, onCreateTeam }: MyTeamsPremiumCarouselProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  // Fetch teams & leagues
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-teams-premium", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user) return [];

      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user.id);

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
            id: t.id, name: t.name, logo_url: t.logo_url, club_id: t.club_id, level_age: null,
          })));

          for (const team of teams) {
            if (activeClubFilter && team.club_id !== activeClubFilter) continue;
            const teamRoles = roles.filter(r => r.team_id === team.id);
            const clubRoles = roles.filter(r => r.club_id === team.club_id);
            const canManage = teamRoles.some(r => ['coach', 'team_admin'].includes(r.role)) ||
              clubRoles.some(r => ['club_admin', 'app_admin'].includes(r.role));
            result.push({
              id: team.id, name: team.name, logo_url: team.logo_url, type: "team",
              club_name: team.clubs?.name || "", sport: team.clubs?.sport || null,
              club_id: team.club_id, canManage,
            });
          }
        }
      }

      // Mini leagues
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user.id);

      const leagueIds = new Set(playerLeagues?.map(p => p.mini_league_id) || []);

      const leagueAdminClubIds = roles
        .filter(r => r.club_id && r.role === "league_admin")
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
            const canManage = leagueAdminClubIds.includes(league.club_id);
            result.push({
              id: league.id, name: league.name, logo_url: null, type: "league",
              club_name: league.clubs?.name || "", sport: league.clubs?.sport || null,
              club_id: league.club_id, canManage,
            });
          }
        }
      }

      // Sort: admin/coach teams first, then by name
      return result.sort((a, b) => {
        // Priority 1: canManage (admin/coach) teams first
        if (a.canManage && !b.canManage) return -1;
        if (!a.canManage && b.canManage) return 1;
        // Priority 2: teams before leagues
        if (a.type === "team" && b.type === "league") return -1;
        if (a.type === "league" && b.type === "team") return 1;
        // Priority 3: alphabetical
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch next events
  const teamIds = items.filter(i => i.type === "team").map(i => i.id);
  const leagueItemIds = items.filter(i => i.type === "league").map(i => i.id);

  const { data: nextEvents = {} } = useQuery({
    queryKey: ["team-next-events-premium", teamIds, leagueItemIds],
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
                type: event.type,
              };
            }
          }
        }
      }

      if (leagueItemIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("mini_league_id, title, type, event_date")
          .in("mini_league_id", leagueItemIds)
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
                type: event.type,
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

  // Fetch recent photos per team
  const { data: teamPhotos = {} } = useQuery({
    queryKey: ["team-photos-premium", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {};
      const map: Record<string, string[]> = {};

      const { data } = await supabase
        .from("photos")
        .select("team_id, file_url, image_url")
        .in("team_id", teamIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(teamIds.length * 2);

      if (data) {
        for (const photo of data) {
          if (!photo.team_id) continue;
          const url = photo.file_url || photo.image_url;
          if (!url) continue;
          if (!map[photo.team_id]) map[photo.team_id] = [];
          if (map[photo.team_id].length < 2) {
            map[photo.team_id].push(url);
          }
        }
      }

      return map;
    },
    enabled: teamIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {[1, 2].map(i => (
            <div key={i} className="shrink-0 w-[82vw] max-w-[320px] h-[120px] rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  const addTeamCard = (onJoinTeam || onCreateTeam) ? (
    <Card
      className="shrink-0 w-[82vw] max-w-[320px] cursor-pointer border border-dashed border-primary/30 bg-card/50 hover:border-primary/60 hover:bg-accent/30 transition-all snap-start"
      onClick={() => {
        if (onJoinTeam && onCreateTeam) {
          // Could show a choice, but for simplicity navigate to create
          onCreateTeam();
        } else if (onJoinTeam) {
          onJoinTeam();
        } else if (onCreateTeam) {
          onCreateTeam();
        }
      }}
    >
      <CardContent className="p-4 flex flex-col items-center justify-center gap-2 min-h-[100px]">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Plus className="h-5 w-5 text-primary" />
        </div>
        <span className="text-sm font-medium text-primary">Join or Create Team</span>
        {onJoinTeam && onCreateTeam && (
          <div className="flex gap-3 mt-1">
            <button
              className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); onJoinTeam(); }}
            >
              Join team
            </button>
            <span className="text-[11px] text-muted-foreground">•</span>
            <button
              className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); onCreateTeam(); }}
            >
              Create team
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;

  // Empty state: show add team as a larger primary card
  if (items.length === 0) {
    if (!addTeamCard) return null;
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <Card
          className="cursor-pointer border border-dashed border-primary/30 bg-card/50 hover:border-primary/60 hover:bg-accent/30 transition-all"
          onClick={() => onCreateTeam?.()}
        >
          <CardContent className="p-6 flex flex-col items-center justify-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">No teams yet</p>
              <p className="text-xs text-muted-foreground">Join an existing team or create a new one</p>
            </div>
            {onJoinTeam && onCreateTeam && (
              <div className="flex gap-4 mt-1">
                <button
                  className="text-sm text-primary font-medium hover:underline"
                  onClick={(e) => { e.stopPropagation(); onJoinTeam(); }}
                >
                  Join team
                </button>
                <button
                  className="text-sm text-primary font-medium hover:underline"
                  onClick={(e) => { e.stopPropagation(); onCreateTeam(); }}
                >
                  Create team
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">My Teams</h2>
      <ScrollArea className="w-full">
        <div className="flex gap-3 pb-3 snap-x snap-mandatory">
          {[...items]
            .sort((a, b) => {
              // Always keep teams ahead of mini leagues
              if (a.type !== b.type) return a.type === "team" ? -1 : 1;
              // Within the same type, admin/coach entries first
              if (a.canManage !== b.canManage) return a.canManage ? -1 : 1;
              // Then items with upcoming events
              const aHasEvent = !!nextEvents[a.id];
              const bHasEvent = !!nextEvents[b.id];
              if (aHasEvent !== bHasEvent) return aHasEvent ? -1 : 1;
              // Then items with photos (activity)
              const aHasPhotos = (teamPhotos[a.id] || []).length > 0;
              const bHasPhotos = (teamPhotos[b.id] || []).length > 0;
              if (aHasPhotos !== bHasPhotos) return aHasPhotos ? -1 : 1;
              // Then alphabetical
              return a.name.localeCompare(b.name);
            })
            .map((item) => (
            <TeamCard
              key={`${item.type}-${item.id}`}
              item={item}
              nextEvent={nextEvents[item.id]}
              photos={teamPhotos[item.id] || []}
            />
          ))}
          {addTeamCard}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}
