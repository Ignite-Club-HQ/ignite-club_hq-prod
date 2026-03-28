import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, isToday, parseISO, startOfDay, isSameDay, nextSaturday } from "date-fns";
import {
  ArrowLeft, Users, Calendar as CalendarIcon, Plus, MoreVertical, Loader2,
  ChevronRight, Clock, MapPin, Shirt, Settings, Trophy, Target, ClipboardList
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ManagePlayersDialog } from "@/components/mini-league/ManagePlayersDialog";
import { MiniLeagueSettingsDialog } from "@/components/mini-league/MiniLeagueSettingsDialog";
import { AddMiniLeagueMemberSheet } from "@/components/AddMiniLeagueMemberSheet";

interface MiniLeagueEvent {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  is_cancelled: boolean;
  final_score_home: number | null;
  final_score_away: number | null;
  _allocatedPlayers?: number;
}

export default function MiniLeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);

  // Fetch mini league details
  const { data: league, isLoading: leagueLoading } = useQuery({
    queryKey: ["mini-league", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*, club:clubs(id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Check if user can manage this league (admin/coach roles)
  const { data: canManageLeague } = useQuery({
    queryKey: ["can-manage-league", league?.club_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .or(`club_id.eq.${league!.club_id},role.eq.app_admin`);

      return data?.some(r =>
        ['club_admin', 'league_admin', 'coach', 'committee_member', 'app_admin'].includes(r.role)
      ) ?? false;
    },
    enabled: !!league?.club_id && !!user,
  });

  // Fetch players count (for header display)
  const { data: players } = useQuery({
    queryKey: ["mini-league-players", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("*")
        .eq("mini_league_id", id!)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch events linked to mini league (with scores and player counts)
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["mini-league-events", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, start_time, end_time, location_name, is_cancelled, final_score_home, final_score_away")
        .eq("mini_league_id", id!)
        .order("event_date", { ascending: false });
      if (error) throw error;

      const eventIds = (data || []).map(e => e.id);
      if (eventIds.length > 0) {
        const { data: groups } = await supabase
          .from("event_groups")
          .select("event_id, id")
          .in("event_id", eventIds);

        if (groups && groups.length > 0) {
          const groupIds = groups.map(g => g.id);
          const { data: groupPlayers } = await supabase
            .from("event_group_players")
            .select("group_id")
            .in("group_id", groupIds);

          const groupToEvent = new Map<string, string>();
          groups.forEach(g => groupToEvent.set(g.id, g.event_id));

          return (data || []).map(e => ({
            ...e,
            _allocatedPlayers: groupPlayers?.filter(gp => groupToEvent.get(gp.group_id) === e.id).length || 0,
          })) as MiniLeagueEvent[];
        }
      }

      return (data || []).map(e => ({ ...e, _allocatedPlayers: 0 })) as MiniLeagueEvent[];
    },
    enabled: !!id,
  });

  // Find the user's children in this league (for parent-facing next session)
  const { data: userPlayerIds } = useQuery({
    queryKey: ["mini-league-user-players", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("mini_league_players")
        .select("id, name")
        .eq("mini_league_id", id!)
        .eq("parent_user_id", user!.id);
      return data || [];
    },
    enabled: !!id && !!user && !canManageLeague,
  });

  // Separate upcoming and past events
  const nonCancelledEvents = events?.filter(e => !e.is_cancelled) || [];
  const upcomingEvents = nonCancelledEvents.filter(e => new Date(e.event_date) >= startOfDay(new Date()));
  const pastEvents = nonCancelledEvents.filter(e => new Date(e.event_date) < startOfDay(new Date()));

  // Compute league status label
  const leagueStatus = events?.length === 0
    ? "Not started"
    : upcomingEvents.length > 0
      ? `${upcomingEvents.length} upcoming`
      : "Completed";

  // Build create URL with pre-filled Round name
  const getCreateUrl = () => {
    const roundNumber = (events?.length || 0) + 1;
    const nextSat = nextSaturday(new Date());
    const dateStr = format(nextSat, "yyyy-MM-dd'T'10:00");
    return `/events/new?type=mini_league&mini_league_id=${id}&club_id=${league?.club_id}&prefill_title=Round ${roundNumber}&prefill_date=${dateStr}`;
  };

  if (leagueLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Mini League not found</p>
        <Button variant="link" onClick={() => navigate("/mini-leagues")}>
          Back to Mini Leagues
        </Button>
      </div>
    );
  }

  const renderMatchDayCard = (event: MiniLeagueEvent, compact = false) => {
    const hasScore = event.final_score_home != null && event.final_score_away != null;
    const isPast = new Date(event.event_date) < startOfDay(new Date());
    const isUpcoming = !isPast;

    return (
      <Card
        key={event.id}
        className="cursor-pointer hover:bg-accent/50 active:scale-[0.99] transition-all rounded-xl"
        onClick={() => navigate(`/events/${event.id}`)}
      >
        <CardContent className={compact ? "py-2.5 px-4" : "py-3.5 px-4"}>
          <div className="flex items-center gap-3">
            <div className={`${compact ? "h-9 w-9 rounded-lg" : "h-12 w-12 rounded-xl"} ${isUpcoming ? "bg-primary/10" : "bg-muted"} flex flex-col items-center justify-center shrink-0`}>
              <span className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold ${isUpcoming ? "text-primary" : "text-muted-foreground"} uppercase leading-none`}>
                {format(parseISO(event.event_date), "MMM")}
              </span>
              <span className={`${compact ? "text-sm" : "text-lg"} font-bold ${isUpcoming ? "text-primary" : "text-muted-foreground"} leading-tight`}>
                {format(parseISO(event.event_date), "d")}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`${compact ? "text-sm" : "font-semibold text-sm"} truncate`}>
                  {event.title || format(parseISO(event.event_date), "EEEE")}
                </span>
                {isToday(parseISO(event.event_date)) && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">Today</Badge>
                )}
                {isPast && !hasScore && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">Completed</Badge>
                )}
                {isUpcoming && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Upcoming</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                {event.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {event.start_time.slice(0, 5)}
                  </span>
                )}
                {!compact && event.location_name && (
                  <span className="flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{event.location_name}</span>
                  </span>
                )}
                {(event._allocatedPlayers || 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {event._allocatedPlayers}
                  </span>
                )}
              </div>
            </div>
            {hasScore && (
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {event.final_score_home} – {event.final_score_away}
              </Badge>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderEmptyState = () => (
    <div className="space-y-6">
      {/* Hero empty state */}
      <Card className="border-dashed border-2 rounded-2xl overflow-hidden">
        <CardContent className="py-10 px-6 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold">Start your Mini League</h2>
            <p className="text-sm text-muted-foreground">
              Create match days, schedule games, and track results
            </p>
          </div>

          {canManageLeague && (
            <Button
              className="mt-2"
              onClick={() => navigate(getCreateUrl())}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Match Day
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 3-step guide */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: CalendarIcon, label: "Create Match Day", step: "1" },
          { icon: Users, label: "Add Games", step: "2" },
          { icon: Target, label: "Track Scores", step: "3" },
        ].map(({ icon: Icon, label, step }) => (
          <div key={step} className="flex flex-col items-center gap-2 text-center">
            <div className="relative">
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {step}
              </span>
            </div>
            <span className="text-xs font-medium text-muted-foreground leading-tight">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTimeline = () => {
    // Show upcoming first, then past — a single unified timeline
    const sortedEvents = [...upcomingEvents.reverse(), ...pastEvents];
    
    return (
      <div className="space-y-5">
        {/* Upcoming section */}
        {upcomingEvents.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Upcoming
            </h2>
            {[...upcomingEvents].reverse().map(event => renderMatchDayCard(event))}
          </div>
        )}

        {/* Recent Results section */}
        {pastEvents.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Recent Results
            </h2>
            {pastEvents.map(event => renderMatchDayCard(event, true))}
          </div>
        )}

        {/* Both empty but events exist (all cancelled) */}
        {upcomingEvents.length === 0 && pastEvents.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No match days to show</p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="shrink-0 h-11 w-11" onClick={() => navigate(league.club_id ? `/mini-leagues?clubId=${league.club_id}` : "/mini-leagues")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-12 w-12 shrink-0">
          {league.logo_url ? <AvatarImage src={league.logo_url} alt={league.name} /> : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
            {league.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight">{league.name}</h1>
          <p className="text-xs text-muted-foreground truncate">{league.club?.name}</p>
        </div>
        {canManageLeague && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 h-11 w-11">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={() => setPlayersOpen(true)}>
                <Users className="h-4 w-4 mr-2" />
                Manage Players
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Edit Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {league.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{league.description}</p>
      )}

      {/* League Overview Card */}
      <Card className="rounded-xl">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => canManageLeague ? setPlayersOpen(true) : undefined}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold leading-tight">{players?.length || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Players</p>
                </div>
              </button>
              <div className="w-px h-8 bg-border" />
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold leading-tight">{leagueStatus}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {events?.length || 0} Match {(events?.length || 0) === 1 ? "Day" : "Days"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parent-facing next match day highlight */}
      {!canManageLeague && upcomingEvents.length > 0 && userPlayerIds && userPlayerIds.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 rounded-xl">
          <CardContent className="py-4 px-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shirt className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Next Match Day</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex flex-col items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-primary uppercase leading-none">
                  {format(parseISO(upcomingEvents[0].event_date), "MMM")}
                </span>
                <span className="text-lg font-bold text-primary leading-tight">
                  {format(parseISO(upcomingEvents[0].event_date), "d")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">
                  {upcomingEvents[0].title || format(parseISO(upcomingEvents[0].event_date), "EEEE")}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  {upcomingEvents[0].start_time && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {upcomingEvents[0].start_time.slice(0, 5)}
                    </span>
                  )}
                  {upcomingEvents[0].location_name && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{upcomingEvents[0].location_name}</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {userPlayerIds.map(p => p.name).join(", ")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => navigate(`/events/${upcomingEvents[0].id}`)}
              >
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Match Days Content */}
      {eventsLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : events?.length === 0 ? (
        renderEmptyState()
      ) : (
        renderTimeline()
      )}

      {/* Floating Action Button */}
      {canManageLeague && (
        <Button
          className="fixed bottom-24 right-4 h-auto rounded-full shadow-lg z-40 sm:bottom-6 sm:right-6 px-5 py-3 gap-2"
          onClick={() => navigate(getCreateUrl())}
          aria-label="Create Match Day"
        >
          <Plus className="h-5 w-5" />
          <span className="text-sm font-semibold">Match Day</span>
        </Button>
      )}

      {/* Extracted Dialogs */}
      <ManagePlayersDialog
        open={playersOpen}
        onOpenChange={setPlayersOpen}
        miniLeagueId={id!}
        miniLeagueName={league.name}
        clubId={league.club_id}
        canManage={!!canManageLeague}
        onOpenAddPlayers={() => setAddPlayersOpen(true)}
      />

      <MiniLeagueSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        league={league}
      />

      {/* Add Players Sheet - rendered at page level to avoid nested overlay issues */}
      {canManageLeague && (
        <AddMiniLeagueMemberSheet
          miniLeagueId={id!}
          miniLeagueName={league.name}
          clubId={league.club_id}
          externalOpen={addPlayersOpen}
          onExternalOpenChange={setAddPlayersOpen}
        />
      )}
    </div>
  );
}
