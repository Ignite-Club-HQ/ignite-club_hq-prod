import { useState, useRef, useCallback } from "react";
import { LogoImage } from "@/components/ui/logo-image";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users, Calendar, Trophy, Plus, ChevronRight, MoreVertical, Image, MessageCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cacheTeams } from "@/lib/clubTeamCache";
import { getSignedPhotoUrls } from "@/hooks/useSignedPhotoUrl";
import { format, isToday, isTomorrow, isThisWeek, parseISO, differenceInDays } from "date-fns";

interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  club_logo_url: string | null;
  type: "team" | "league";
  club_name: string;
  sport: string | null;
  club_id: string;
  canManage: boolean;
  isOnTrial?: boolean;
}

interface NextEventInfo {
  title: string;
  dateLabel: string;
  type: string;
  eventDate: string;
}

interface DateParts {
  timeLabel: string;
  dayLabel: string;
  pill: string | null;
}

function formatShortDate(dateStr: string): string {
  const p = formatDateParts(dateStr);
  return `${p.dayLabel} ${p.timeLabel}${p.pill ? ` (${p.pill})` : ""}`;
}

function formatDateParts(dateStr: string): DateParts {
  const date = parseISO(dateStr);
  const now = new Date();
  const time = format(date, "h:mma").toLowerCase();
  const days = differenceInDays(date, now);
  if (isToday(date)) return { timeLabel: time, dayLabel: "Today", pill: "Today" };
  if (isTomorrow(date)) return { timeLabel: time, dayLabel: "Tomorrow", pill: "in 1d" };
  if (days >= 0 && days <= 6) return { timeLabel: time, dayLabel: format(date, "EEEE"), pill: `in ${days}d` };
  return { timeLabel: time, dayLabel: format(date, "EEE d MMM"), pill: null };
}


function TeamCard({ item, nextEvent, photos, unreadMessages }: { 
  item: TeamOrLeague; 
  nextEvent?: NextEventInfo;
  photos: { id: string; url: string }[];
  unreadMessages?: number;
}) {
  const navigate = useNavigate();
  const [showDots, setShowDots] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    longPressTriggered.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowDots(true);
    }, 600);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
    const dy = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
    if (dx > 10 || dy > 10) { clearLongPress(); }
  }, [clearLongPress]);

  const handleTouchEnd = useCallback(() => { clearLongPress(); }, [clearLongPress]);

  const handleCardClick = useCallback(() => {
    if (longPressTriggered.current) { longPressTriggered.current = false; return; }
    navigate(item.type === "team" ? `/teams/${item.id}` : `/mini-leagues/${item.id}`);
  }, [navigate, item.type, item.id]);

  const hasActivity = !!nextEvent || photos.length > 0 || (unreadMessages && unreadMessages > 0);

  const eventTypeStyles: Record<string, { dot: string; label: string }> = {
    game: { dot: "bg-destructive", label: "Game" },
    mini_league: { dot: "bg-destructive", label: "Match" },
    training: { dot: "bg-primary", label: "Training" },
    social: { dot: "bg-warning", label: "Social" },
  };
  const evStyle = nextEvent ? (eventTypeStyles[nextEvent.type] || { dot: "bg-primary", label: "Event" }) : null;
  const dateParts = nextEvent ? formatDateParts(nextEvent.eventDate) : null;

  return (
    <Card
      className="shrink-0 w-[85vw] max-w-[320px] cursor-pointer border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-border transition-all snap-start overflow-hidden relative"
      role="button"
      tabIndex={0}
      aria-label={`${item.name} — ${item.club_name}`}
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(item.type === "team" ? `/teams/${item.id}` : `/mini-leagues/${item.id}`);
        }
      }}
    >
      <CardContent className="p-4 flex flex-col gap-3">
        {/* Header: logo + name/club + actions */}
        <div className="flex items-start gap-3">
          {(item.logo_url || item.club_logo_url) ? (
            <LogoImage
              src={(item.logo_url || item.club_logo_url)!}
              className="h-10 w-10 rounded-full object-cover shrink-0"
              fallback={
                <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted">
                  {item.type === "league" ? <Trophy className="h-5 w-5 text-muted-foreground" /> : <Users className="h-5 w-5 text-muted-foreground" />}
                </div>
              }
            />
          ) : (
            <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted">
              {item.type === "league" ? <Trophy className="h-5 w-5 text-muted-foreground" /> : <Users className="h-5 w-5 text-muted-foreground" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-base leading-tight truncate text-foreground">{item.name}</h3>
              {unreadMessages && unreadMessages > 0 ? (
                <Badge className="bg-primary text-primary-foreground text-[10px] h-[18px] min-w-[18px] px-1.5 shrink-0 rounded-full">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </Badge>
              ) : null}
              {item.isOnTrial && (
                <Badge variant="outline" className="text-amber-600 border-amber-500 text-[9px] px-1 py-0 h-[16px] shrink-0">Trial</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.club_name}</p>
          </div>
          {showDots && (
            <div className="shrink-0 -mr-1 -mt-1" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu onOpenChange={(open) => { if (!open) setShowDots(false); }}>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-7 w-7 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-muted transition-colors"
                    aria-label="Team actions"
                  >
                    <MoreVertical className="h-4 w-4 text-foreground/70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => navigate(item.type === "league" ? `/mini-leagues/${item.id}` : "/events")}>
                    <Calendar className="h-4 w-4 mr-2" />
                    View schedule
                  </DropdownMenuItem>
                  {item.canManage && (
                    <DropdownMenuItem onClick={() => navigate(item.type === "league" ? `/events/new?type=mini_league&mini_league_id=${item.id}&club_id=${item.club_id}` : "/events/new")}>
                      <Plus className="h-4 w-4 mr-2" />
                      {item.type === "league" ? "Add match" : "Add event"}
                    </DropdownMenuItem>
                  )}
                  {photos.length > 0 && (
                    <DropdownMenuItem onClick={() => navigate(item.type === "league" ? `/media?miniLeague=${item.id}` : `/media?team=${item.id}`)}>
                      <Image className="h-4 w-4 mr-2" />
                      View photos
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Event block */}
        {nextEvent && evStyle && dateParts ? (
          <div className="rounded-md bg-muted/40 px-3 py-2.5 flex flex-col gap-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${evStyle.dot}`} aria-hidden="true" />
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground shrink-0">{evStyle.label}</span>
              <span className="text-sm font-medium text-foreground truncate">{nextEvent.title.replace(/^(Game|Training|Social|Match)\s*v?\s*/i, "")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{dateParts.dayLabel} · {dateParts.timeLabel}</span>
              {dateParts.pill && (
                <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {dateParts.pill}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground italic">No upcoming events</span>
            {item.canManage ? (
              <button
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline shrink-0"
                onClick={(e) => { e.stopPropagation(); navigate(item.type === "league" ? `/events/new?type=mini_league&mini_league_id=${item.id}&club_id=${item.club_id}` : "/events/new"); }}
              >
                <Plus className="h-3 w-3" />
                Schedule
              </button>
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </div>
        )}

        {/* Footer: photos + unread (subtle) */}
        {(photos.length > 0 || (unreadMessages && unreadMessages > 0)) && (
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
            {photos.length > 0 ? (
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(item.type === "league" ? `/media?miniLeague=${item.id}` : `/media?team=${item.id}`);
                }}
              >
                <div className="flex -space-x-1.5 shrink-0">
                  {photos.slice(0, 3).map((photo, i) => (
                    <div
                      key={i}
                      className="h-7 w-7 rounded-md overflow-hidden bg-muted ring-2 ring-card shrink-0"
                    >
                      <img
                        src={photo.url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground truncate">
                  {photos.length} new photo{photos.length > 1 ? "s" : ""}
                </span>
              </button>
            ) : <span />}
            {unreadMessages && unreadMessages > 0 ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                <MessageCircle className="h-3 w-3" />
                {unreadMessages}
              </span>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MyTeamsPremiumCarousel() {
  const { user, initialized } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  // Fetch teams & leagues
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-teams-premium", user?.id, activeClubFilter],
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
          .select("id, name, logo_url, club_id, is_pro, pro_expires_at, clubs(name, sport, logo_url)")
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
              id: team.id, name: team.name, logo_url: team.logo_url,
              club_logo_url: team.clubs?.logo_url || null,
              type: "team",
              club_name: team.clubs?.name || "", sport: team.clubs?.sport || null,
              club_id: team.club_id, canManage,
              isOnTrial: !!(team.is_pro && team.pro_expires_at),
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
          .select("id, name, club_id, clubs(name, sport, logo_url)")
          .in("id", Array.from(leagueIds));

        if (leagues) {
          for (const league of leagues) {
            if (activeClubFilter && league.club_id !== activeClubFilter) continue;
            const canManage = leagueAdminClubIds.includes(league.club_id);
            result.push({
              id: league.id, name: league.name, logo_url: null,
              club_logo_url: league.clubs?.logo_url || null,
              type: "league",
              club_name: league.clubs?.name || "", sport: league.clubs?.sport || null,
              club_id: league.club_id, canManage,
            });
          }
        }
      }

      // Initial sort (without event dates — final activity sort happens in render once nextEvents resolves)
      return result.sort((a, b) => {
        if (a.canManage && !b.canManage) return -1;
        if (!a.canManage && b.canManage) return 1;
        if (a.type === "team" && b.type === "league") return -1;
        if (a.type === "league" && b.type === "team") return 1;
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch next events
  const teamIds = items.filter(i => i.type === "team").map(i => i.id);
  const leagueItemIds = items.filter(i => i.type === "league").map(i => i.id);

  const { data: nextEvents = {} } = useQuery({
    queryKey: ["team-next-events-premium", teamIds, leagueItemIds],
    queryFn: async () => {
      const now = new Date().toISOString();
      const map: Record<string, NextEventInfo> = {};

      const extractOpponent = (title: string): string | null => {
        // Match " v " or " vs " (case-insensitive). Take the right-hand side.
        const m = title.match(/\s+vs?\.?\s+(.+)$/i);
        return m ? m[1].trim() : null;
      };
      const buildLabel = (type: string | null, opponent: string | null, title: string) => {
        if (type === "training") return "Training";
        if (type === "social") return "Social";
        const opp = opponent || extractOpponent(title);
        if ((type === "game" || type === "mini_league") && opp) return `Game v ${opp}`;
        if (type === "game" || type === "mini_league") return "Game";
        return title;
      };

      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("team_id, title, type, opponent, event_date")
          .in("team_id", teamIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.team_id && !map[event.team_id]) {
              map[event.team_id] = {
                title: buildLabel(event.type, event.opponent, event.title),
                dateLabel: formatShortDate(event.event_date),
                type: event.type,
                eventDate: event.event_date,
              };
            }
          }
        }
      }

      if (leagueItemIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("mini_league_id, title, type, opponent, event_date")
          .in("mini_league_id", leagueItemIds)
          .gte("event_date", now)
          .eq("is_cancelled", false)
          .order("event_date", { ascending: true })
          .limit(50);

        if (data) {
          for (const event of data) {
            if (event.mini_league_id && !map[event.mini_league_id]) {
              map[event.mini_league_id] = {
                title: buildLabel(event.type, event.opponent, event.title),
                dateLabel: formatShortDate(event.event_date),
                type: event.type,
                eventDate: event.event_date,
              };
            }
          }
        }
      }

      return map;
    },
    enabled: items.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch recent photos per team
  const { data: teamPhotos = {} } = useQuery({
    queryKey: ["team-photos-premium", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {};
      const map: Record<string, { id: string; url: string }[]> = {};

      const { data } = await supabase
        .from("photos")
        .select("id, team_id, file_url, image_url")
        .in("team_id", teamIds)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(teamIds.length * 2);

      if (data) {
        // Collect raw URLs first, then resolve to signed URLs in one batch
        const rawUrls: string[] = [];
        const entries: { teamId: string; id: string; rawUrl: string }[] = [];
        for (const photo of data) {
          if (!photo.team_id) continue;
          const url = photo.file_url || photo.image_url;
          if (!url) continue;
          if (!map[photo.team_id]) map[photo.team_id] = [];
          if (entries.filter((e) => e.teamId === photo.team_id).length >= 2) continue;
          entries.push({ teamId: photo.team_id, id: photo.id, rawUrl: url });
          rawUrls.push(url);
        }

        const signed = await getSignedPhotoUrls(rawUrls);
        for (const entry of entries) {
          map[entry.teamId].push({ id: entry.id, url: signed[entry.rawUrl] || entry.rawUrl });
        }
      }

      return map;
    },
    enabled: teamIds.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch unread message counts per team
  const { data: unreadCounts = {} } = useQuery({
    queryKey: ["team-unread-counts", teamIds, user?.id],
    queryFn: async () => {
      if (teamIds.length === 0 || !user?.id) return {};
      const map: Record<string, number> = {};

      // Get all team_message_ids that user has read
      const { data: readMessages } = await supabase
        .from("message_reads")
        .select("team_message_id")
        .eq("user_id", user.id)
        .not("team_message_id", "is", null);

      const readIds = new Set((readMessages || []).map(r => r.team_message_id).filter(Boolean));

      for (const teamId of teamIds) {
        try {
          // Get all messages in this team not by the current user
          const { data: messages } = await supabase
            .from("team_messages")
            .select("id")
            .eq("team_id", teamId)
            .is("deleted_at", null)
            .neq("author_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50);

          const unread = (messages || []).filter(m => !readIds.has(m.id)).length;
          if (unread > 0) map[teamId] = unread;
        } catch {
          // Ignore errors for individual teams
        }
      }

      return map;
    },
    enabled: teamIds.length > 0 && !!user?.id,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My Teams</h2>
        <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide">
          {[1, 2].map(i => (
            <div key={i} className="shrink-0 w-[85vw] max-w-[340px] h-[158px] rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }


  const showCreateClub = !activeClubFilter;

  // Empty state: onboarding with clear paths
  if (items.length === 0) {
    return null;
  }

  const createClubCard = showCreateClub ? (
    <Card
      className="min-w-[200px] max-w-[200px] snap-start cursor-pointer border border-dashed border-primary/30 bg-card/50 hover:border-primary/60 hover:bg-accent/30 transition-all shrink-0"
      onClick={() => navigate("/clubs", { state: { fromCreateClub: true } })}
    >
      <CardContent className="p-4 flex flex-col items-center justify-center gap-2 h-full text-center">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium">Create a Club</p>
        <p className="text-[11px] text-muted-foreground leading-tight">Start a new organisation</p>
      </CardContent>
    </Card>
  ) : null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold px-1">My Teams</h2>
      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 pb-2 snap-x snap-mandatory pr-4">
          {items.map((item) => (
            <TeamCard
              key={`${item.type}-${item.id}`}
              item={item}
              nextEvent={nextEvents[item.id]}
              photos={teamPhotos[item.id] || []}
              unreadMessages={unreadCounts[item.id]}
            />
          ))}
          {createClubCard}
        </div>
      </div>
    </section>
  );
}
