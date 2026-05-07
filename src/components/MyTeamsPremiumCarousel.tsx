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
  const accentBorder = nextEvent ? (eventAccentColors[nextEvent.type] || "border-l-primary") : "";

  // Build activity indicators
  const activityItems: React.ReactNode[] = [];
  if (nextEvent) {
    activityItems.push(
      <div key="event" className="flex items-center gap-2 text-sm">
        <Calendar className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground truncate">
          {nextEvent.title}
        </span>
        <span className="text-muted-foreground text-xs shrink-0">
          {nextEvent.dateLabel}
        </span>
      </div>
    );
  }
  if (unreadMessages && unreadMessages > 0) {
    activityItems.push(
      <div key="messages" className="flex items-center gap-2 text-sm">
        <MessageCircle className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="text-foreground font-medium">
          {unreadMessages} unread message{unreadMessages > 1 ? "s" : ""}
        </span>
      </div>
    );
  }
  if (photos.length > 0) {
    activityItems.push(
      <div key="photos" className="flex items-center gap-2 text-sm">
        <Image className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground">
          {photos.length} new photo{photos.length > 1 ? "s" : ""}
        </span>
      </div>
    );
  }

  return (
    <Card
      className={`shrink-0 w-[85vw] max-w-[340px] min-h-[158px] cursor-pointer border bg-card transition-all snap-start overflow-hidden relative ${
        hasActivity 
          ? `border-l-[3px] ${accentBorder || "border-l-primary"} shadow-md hover:shadow-lg` 
          : "hover:border-primary/40 shadow-sm hover:shadow-md"
      }`}
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
      <CardContent className="p-4 space-y-3.5">
        {/* Header: avatar + name + badges + menu */}
        <div className="flex items-center gap-3">
          {(item.logo_url || item.club_logo_url) ? (
            <LogoImage
              src={(item.logo_url || item.club_logo_url)!}
              className="h-11 w-11 rounded-full object-cover shrink-0 ring-2 ring-primary/20"
              fallback={
                <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${
                  item.type === "league" ? "bg-accent/60 ring-2 ring-accent" : "bg-primary/10 ring-2 ring-primary/20"
                }`}>
                  {item.type === "league" ? <Trophy className="h-5 w-5 text-accent-foreground" /> : <Users className="h-5 w-5 text-primary" />}
                </div>
              }
            />
          ) : (
            <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${
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
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[15px] leading-tight truncate">{item.name}</h3>
              {/* Unread badge next to name */}
              {unreadMessages && unreadMessages > 0 && (
                <Badge className="bg-primary text-primary-foreground text-[9px] h-[18px] min-w-[18px] px-1.5 shrink-0 rounded-full">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] text-muted-foreground/70 truncate">{item.club_name}</p>
              {item.isOnTrial && (
                <Badge variant="outline" className="text-amber-600 border-amber-500 text-[9px] px-1 py-0 h-3.5 shrink-0">Trial</Badge>
              )}
            </div>
          </div>
          {showDots && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
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

        {/* Activity section — always show something meaningful */}
        <div className="space-y-2 min-h-[48px]">
          {activityItems.length > 0 ? (
            activityItems
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                <span className="italic text-xs">No upcoming events</span>
              </div>
              {item.canManage ? (
                <button
                  className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
                  onClick={(e) => { e.stopPropagation(); navigate(item.type === "league" ? `/events/new?type=mini_league&mini_league_id=${item.id}&club_id=${item.club_id}` : "/events/new"); }}
                >
                  <Plus className="h-3 w-3" />
                  Schedule {item.type === "league" ? "match" : "training"}
                </button>
              ) : (
                <button
                  className="flex items-center gap-1 text-xs text-primary font-medium hover:underline"
                  onClick={(e) => { e.stopPropagation(); navigate(item.type === "team" ? `/teams/${item.id}` : `/mini-leagues/${item.id}`); }}
                >
                  View {item.type === "team" ? "team" : "league"}
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Photo thumbnails — tap goes to specific photo */}
        {photos.length > 0 && (
          <div className="flex gap-1.5">
            {photos.slice(0, 2).map((photo, i) => (
              <div
                key={i}
                className="h-14 w-[72px] rounded-md overflow-hidden bg-muted cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/media?photo=${photo.id}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/media?photo=${photo.id}`);
                  }
                }}
              >
                <img
                  src={photo.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = "none";
                    const parent = img.parentElement;
                    if (parent && !parent.querySelector("[data-photo-fallback]")) {
                      parent.classList.add("flex", "items-center", "justify-center", "bg-muted");
                      const span = document.createElement("span");
                      span.setAttribute("data-photo-fallback", "true");
                      span.className = "text-muted-foreground";
                      span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                      parent.appendChild(span);
                    }
                  }}
                />
              </div>
            ))}
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

      // Fetch next-event dates for stable activity-based sorting
      const now = new Date().toISOString();
      const resultTeamIds = result.filter(r => r.type === "team").map(r => r.id);
      const resultLeagueIds = result.filter(r => r.type === "league").map(r => r.id);
      const nextEventDate: Record<string, string> = {};

      const eventFetches: Promise<void>[] = [];
      if (resultTeamIds.length > 0) {
        eventFetches.push(
          supabase
            .from("events")
            .select("team_id, event_date")
            .in("team_id", resultTeamIds)
            .gte("event_date", now)
            .eq("is_cancelled", false)
            .order("event_date", { ascending: true })
            .limit(resultTeamIds.length * 2)
            .then(({ data }) => {
              data?.forEach(e => { if (e.team_id && !nextEventDate[e.team_id]) nextEventDate[e.team_id] = e.event_date; });
            }) as Promise<void>
        );
      }
      if (resultLeagueIds.length > 0) {
        eventFetches.push(
          supabase
            .from("events")
            .select("mini_league_id, event_date")
            .in("mini_league_id", resultLeagueIds)
            .gte("event_date", now)
            .eq("is_cancelled", false)
            .order("event_date", { ascending: true })
            .limit(resultLeagueIds.length * 2)
            .then(({ data }) => {
              data?.forEach(e => { if (e.mini_league_id && !nextEventDate[e.mini_league_id]) nextEventDate[e.mini_league_id] = e.event_date; });
            }) as Promise<void>
        );
      }
      await Promise.all(eventFetches);

      // Sort: active roles first, then by upcoming activity, then teams > leagues, then alphabetical
      return result.sort((a, b) => {
        // Priority 1: canManage (coach/team_admin/club_admin) first
        if (a.canManage && !b.canManage) return -1;
        if (!a.canManage && b.canManage) return 1;
        // Priority 2: has upcoming event before no event
        const aDate = nextEventDate[a.id];
        const bDate = nextEventDate[b.id];
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
        // Priority 3: soonest event first
        if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
        // Priority 4: teams before leagues
        if (a.type === "team" && b.type === "league") return -1;
        if (a.type === "league" && b.type === "team") return 1;
        // Priority 5: alphabetical
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
      <h2 className="text-lg font-semibold">My Teams</h2>
      <ScrollArea className="w-full">
        <div className="flex gap-3 pb-3 snap-x snap-mandatory">
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
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}
