import { useState, useMemo, useEffect } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Plus, List, CalendarDays, Repeat, FileSpreadsheet, Filter, CalendarPlus, CalendarPlus2 } from "lucide-react";
import { exportEventsIcs } from "@/lib/icsExport";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EventCard } from "@/components/events/EventCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageLoading } from "@/components/ui/page-loading";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { supabase } from "@/integrations/supabase/client";
import { getCachedEventsList, cacheEventsList } from "@/lib/scheduleCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, startOfDay, isSameDay, subHours, addDays } from "date-fns";
import { getSportEmoji } from "@/lib/sportEmojis";
import { useClubTheme } from "@/hooks/useClubTheme";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { useUserEventViews } from "@/hooks/useEventViews";
import { ScheduleDateStrip } from "@/components/events/ScheduleDateStrip";
import { ClubDaySummary } from "@/components/events/ClubDaySummary";

type EventType = "game" | "training" | "social";

interface Event {
  id: string;
  title: string;
  type: EventType;
  event_date: string;
  address: string | null;
  suburb: string | null;
  location_name: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null };
}


export default function EventsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  usePageTitle("Schedule");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeClubFilter } = useClubTheme();
  const teamFilter = searchParams.get("team");
  // Use club theme filter if set, otherwise use URL param
  const clubFilter = activeClubFilter || searchParams.get("club");
  const [filter, setFilter] = useState<"all" | EventType>("all");
  // Initialize from profile preference or default to list
  const savedViewMode = (profile as any)?.events_view_mode as "list" | "calendar" | undefined;
  const [viewMode, setViewMode] = useState<"list" | "calendar">(savedViewMode || "list");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  // Day filter for list view (separate from calendar's selectedDate)
  const [listSelectedDate, setListSelectedDate] = useState<Date | null>(null);
  const [stripWeekAnchor, setStripWeekAnchor] = useState<Date>(() => new Date());
  const [showFilters, setShowFilters] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  
  // Track if filters are active
  const hasActiveFilters = clubFilter !== null || teamFilter !== null;

  // Update view mode when profile loads
  useEffect(() => {
    if (savedViewMode) {
      setViewMode(savedViewMode);
    }
  }, [savedViewMode]);

  // Persist view mode preference to profile
  const handleViewModeChange = async (newMode: "list" | "calendar") => {
    setViewMode(newMode);
    if (user) {
      await supabase
        .from("profiles")
        .update({ events_view_mode: newMode })
        .eq("id", user.id);
      // Refresh profile to sync the change
      refreshProfile();
    }
  };

  // Sync URL params with theme filter - clear when theme is removed
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (activeClubFilter) {
      params.set("club", activeClubFilter);
    } else {
      params.delete("club");
    }
    setSearchParams(params, { replace: true });
  }, [activeClubFilter]);

  // ─── Diagnostic logging for hung-spinner debugging ───
  // Uses console.warn so messages survive the production console silencer.
  const diagLog = (step: string, extra?: Record<string, unknown>) => {
    console.warn(`[ScheduleDiag] ${step}`, { t: new Date().toISOString(), userId: user?.id, ...extra });
  };

  // Fetch user's clubs (clubs they are members of)
  const { data: userClubs } = useQuery({
    queryKey: ["user-clubs-for-filter", user?.id],
    queryFn: async () => {
      const start = performance.now();
      diagLog("userClubs:start");
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      diagLog("userClubs:roles-resolved", { ms: Math.round(performance.now() - start), rolesCount: roles?.length ?? null, error: error?.message });

      if (!roles) return [];
      
      // Get unique club IDs (direct club roles + clubs from team roles)
      const clubIds = new Set<string>();
      const teamIds: string[] = [];
      
      roles.forEach(r => {
        if (r.club_id) clubIds.add(r.club_id);
        if (r.team_id) teamIds.push(r.team_id);
      });
      
      // Get clubs from teams
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teams?.forEach(t => clubIds.add(t.club_id));
      }
      
      if (clubIds.size === 0) return [];
      
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, sport")
        .in("id", Array.from(clubIds))
        .order("name");
      
      return clubs || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const { data: userTeams } = useQuery({
    queryKey: ["user-teams-for-filter", user?.id, clubFilter],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user!.id);
      
      if (!roles) return [];
      
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id!);
      const clubRoleClubIds = roles.filter(r => r.club_id && !r.team_id).map(r => r.club_id!);
      
      let query = supabase.from("teams").select("id, name, club_id").order("name");
      
      if (clubFilter) {
        // If club is selected, show all teams in that club if user is club admin, else only their teams
        const isClubAdmin = clubRoleClubIds.includes(clubFilter);
        if (isClubAdmin) {
          query = query.eq("club_id", clubFilter);
        } else {
          query = query.eq("club_id", clubFilter).in("id", teamIds);
        }
      } else {
        // No club filter - show all user's teams
        if (teamIds.length === 0) return [];
        query = query.in("id", teamIds);
      }
      
      const { data: teams } = await query;
      return teams || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get user's accessible team, club, and mini league IDs for event filtering
  const { data: userMemberships, isLoading: membershipsLoading } = useQuery({
    queryKey: ["user-memberships-for-events", user?.id],
    queryFn: async () => {
      const overall = performance.now();
      diagLog("memberships:start");
      let step = performance.now();
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);
      diagLog("memberships:user_roles", { ms: Math.round(performance.now() - step), rolesCount: roles?.length ?? null, error: rolesErr?.message });

      if (!roles) {
        diagLog("memberships:end-no-roles", { totalMs: Math.round(performance.now() - overall) });
        return { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [] };
      }
      
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id) as string[];
      const clubIds = new Set<string>();
      const clubAdminClubIds = new Set<string>();
      const leagueAdminClubIds = new Set<string>();
      
      // Direct club roles
      roles.forEach(r => {
        if (r.club_id) {
          clubIds.add(r.club_id);
          // Track club admin roles for team event visibility
          if (r.role === 'club_admin' || r.role === 'app_admin') {
            clubAdminClubIds.add(r.club_id);
          }
          // Track club admin roles for league access
          if (r.role === 'club_admin' || r.role === 'league_admin' || r.role === 'app_admin') {
            leagueAdminClubIds.add(r.club_id);
          }
        }
      });
      
      // Get club IDs from team memberships
      if (teamIds.length > 0) {
        step = performance.now();
        const { data: teams, error: teamsErr } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        diagLog("memberships:teams-lookup", { ms: Math.round(performance.now() - step), teamCount: teams?.length ?? null, error: teamsErr?.message });
        teams?.forEach(t => clubIds.add(t.club_id));
      }
      
      // Get mini league IDs where user is a parent (has a player)
      step = performance.now();
      const { data: playerLeagues, error: pLeaguesErr } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);
      diagLog("memberships:mini_league_players", { ms: Math.round(performance.now() - step), count: playerLeagues?.length ?? null, error: pLeaguesErr?.message });
      
      const miniLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      
      // Also get mini leagues where user is league admin via club_admin role
      step = performance.now();
      const { data: adminLeagues, error: adminLeaguesErr } = await supabase
        .from("mini_leagues")
        .select("id")
        .in("club_id", Array.from(leagueAdminClubIds));
      diagLog("memberships:mini_leagues-admin", { ms: Math.round(performance.now() - step), count: adminLeagues?.length ?? null, error: adminLeaguesErr?.message });
      
      // Add leagues where user is admin
      adminLeagues?.forEach(l => {
        if (!miniLeagueIds.includes(l.id)) {
          miniLeagueIds.push(l.id);
        }
      });
      
      diagLog("memberships:end", { totalMs: Math.round(performance.now() - overall), teamIds: teamIds.length, clubIds: clubIds.size, miniLeagueIds: miniLeagueIds.length });
      return { 
        teamIds, 
        clubIds: Array.from(clubIds), 
        clubAdminClubIds: Array.from(clubAdminClubIds),
        leagueAdminClubIds: Array.from(leagueAdminClubIds),
        miniLeagueIds 
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const eventsScopeKey = useMemo(
    () => `${user?.id || "anon"}_${filter}_${teamFilter || "all"}_${clubFilter || "all"}`,
    [user?.id, filter, teamFilter, clubFilter]
  );

  const { data: events, isLoading, isFetching } = useQuery({
    queryKey: ["events", user?.id, filter, teamFilter, clubFilter, userMemberships?.teamIds, userMemberships?.clubIds, userMemberships?.miniLeagueIds],
    queryFn: async () => {
      const overall = performance.now();
      diagLog("events:start", { hasMemberships: !!userMemberships });
      if (!userMemberships) return [];

      const { teamIds, clubIds, miniLeagueIds } = userMemberships;
      if (teamIds.length === 0 && clubIds.length === 0) {
        diagLog("events:end-empty-memberships");
        return [];
      }

      // Offline fallback: serve cached events list
      if (!navigator.onLine) {
        const cached = getCachedEventsList(eventsScopeKey);
        diagLog("events:offline-cache", { hasCached: !!cached });
        if (cached) return cached as Event[];
      }

      // Only fetch events from the last 30 days onward to avoid pulling entire history
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let query = supabase
        .from("events")
        .select(`
          id,
          title,
          type,
          event_date,
          start_time,
          end_time,
          description,
          address,
          suburb,
          state,
          postcode,
          location_name,
          club_id,
          team_id,
          mini_league_id,
          is_cancelled,
          is_recurring,
          parent_event_id,
          opponent,
          arrival_minutes_before,
          updated_at,
          teams (name, default_match_arrival_minutes),
          clubs (name, sport)
        `)
        .gte("event_date", thirtyDaysAgo.toISOString().split('T')[0])
        .order("event_date", { ascending: true });

      if (filter !== "all") query = query.eq("type", filter);
      if (clubFilter) query = query.eq("club_id", clubFilter);
      if (teamFilter) query = query.eq("team_id", teamFilter);

      const queryStart = performance.now();
      const { data, error } = await query;
      diagLog("events:query-resolved", { ms: Math.round(performance.now() - queryStart), rows: data?.length ?? null, error: error?.message });
      if (error) {
        // Network failed — try cache as fallback
        const cached = getCachedEventsList(eventsScopeKey);
        diagLog("events:error-fallback-cache", { hasCached: !!cached, error: error.message });
        if (cached) return cached as Event[];
        throw error;
      }

      const cutoffTime = subHours(new Date(), 48);
      let filteredData = (data as (Event & { updated_at: string; mini_league_id: string | null })[]).filter(event => {
        if (!event.is_cancelled) return true;
        const updatedAt = new Date(event.updated_at);
        return updatedAt > cutoffTime;
      });

      const { clubAdminClubIds } = userMemberships;
      filteredData = filteredData.filter(event => {
        if (event.mini_league_id) {
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          if (teamFilter && teamFilter === event.team_id && clubAdminClubIds.includes(event.club_id)) {
            return true;
          }
          return teamIds.includes(event.team_id);
        } else {
          return clubIds.includes(event.club_id);
        }
      });

      const { filterRecurringEvents } = await import("@/lib/filterRecurringEvents");
      const finalEvents = filterRecurringEvents(filteredData) as Event[];

      // Cache for offline use
      cacheEventsList(eventsScopeKey, finalEvents);

      return finalEvents;
    },
    enabled: !!user && !!userMemberships,
    staleTime: 3 * 60 * 1000, // Cache for 3 minutes to reduce refetches
    placeholderData: (prev) => prev,
  });

  // Check if user is app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const { data: userRoles } = useQuery({
    queryKey: ["user-admin-roles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get IDs of events user has viewed
  const eventIds = events?.map(e => e.id) || [];
  const { data: viewedEventIds } = useUserEventViews(user?.id, eventIds);

  const handleClubChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("club");
      params.delete("team"); // Clear team when club changes
    } else {
      params.set("club", value);
      params.delete("team"); // Clear team when club changes
    }
    setSearchParams(params);
  };

  const handleTeamChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("team");
    } else {
      params.set("team", value);
    }
    setSearchParams(params);
  };

  const isAdminForEvent = (event: Event) => {
    if (isAppAdmin) return true;
    return userRoles?.some(r => 
      (["club_admin", "team_admin", "coach", "committee_member"].includes(r.role)) &&
      (r.club_id === event.club_id || r.team_id === event.team_id)
    );
  };

  const upcomingEvents = events?.filter(
    (e) => new Date(e.event_date) >= startOfDay(new Date())
  );
  const pastEvents = events?.filter(
    (e) => new Date(e.event_date) < startOfDay(new Date())
  );

  // Get events for selected date in calendar view
  const selectedDateEvents = selectedDate
    ? events?.filter((e) => isSameDay(parseISO(e.event_date), selectedDate))
    : [];

  // Get dates that have events for calendar highlighting
  const eventDates = events?.map((e) => parseISO(e.event_date)) || [];

  // Day-of-week dot indicators for the list-view date strip
  const daysWithEventsKeySet = useMemo(() => {
    const set = new Set<string>();
    (events || []).forEach((e) => {
      try {
        set.add(format(parseISO(e.event_date), "yyyy-MM-dd"));
      } catch {
        // ignore malformed dates
      }
    });
    return set;
  }, [events]);

  // List-view: events on the chosen day (only when date strip is active)
  const listDayEvents = useMemo(() => {
    if (!listSelectedDate) return null;
    return (events || []).filter((e) => isSameDay(parseISO(e.event_date), listSelectedDate));
  }, [events, listSelectedDate]);

  // Only show full-page loading on first ever load (no cached data).
  // Also wait when userMemberships is still loading (events query is disabled until it resolves).
  const isInitialLoad = !events && !upcomingEvents && !pastEvents;
  const isStuckOnSpinner = isInitialLoad && (isLoading || membershipsLoading || !userMemberships);

  // Diagnostic: log what's blocking the spinner so we can see it client-side.
  useEffect(() => {
    console.warn("[ScheduleDiag] render-state", {
      t: new Date().toISOString(),
      hasUser: !!user,
      userId: user?.id,
      hasMemberships: !!userMemberships,
      membershipsLoading,
      eventsLoading: isLoading,
      eventsFetching: isFetching,
      hasEvents: !!events,
      eventsCount: events?.length ?? null,
      isInitialLoad,
      isStuckOnSpinner,
    });
  }, [user, userMemberships, membershipsLoading, isLoading, isFetching, events, isInitialLoad, isStuckOnSpinner]);

  if (isStuckOnSpinner) {
    return <PageLoading message="Loading events..." />;
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex items-center gap-2">
          {/* Filter button - secondary action, only show if there are filters to display */}
          {((userClubs?.length || 0) > 1 || (userTeams?.length || 0) > 0) && (
            <Button
              variant={hasActiveFilters ? "default" : "outline"}
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
              className="relative"
              aria-label="Filter"
            >
              <Filter className="h-4 w-4" />
              {hasActiveFilters && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          )}

          {/* Primary action: + opens an action menu */}
          <Button
            size="icon"
            variant="default"
            onClick={() => {
              const canCreate =
                isAppAdmin ||
                userRoles?.some((r) =>
                  ["club_admin", "team_admin", "coach", "committee_member"].includes(r.role),
                );
              // If the user can't create, jump straight to add-to-calendar export.
              if (!canCreate) {
                // Trigger the same export flow inline
                const evts = upcomingEvents || [];
                if (!evts.length) {
                  toast({ title: "No upcoming events to export" });
                  return;
                }
                exportEventsIcs(
                  evts.map((e: any) => ({
                    id: e.id,
                    title: e.title,
                    type: e.type,
                    event_date: e.event_date,
                    start_time: e.start_time,
                    end_time: e.end_time,
                    description: e.description,
                    location_name: e.location_name,
                    address: e.address,
                    suburb: e.suburb,
                    state: e.state,
                    postcode: e.postcode,
                    is_cancelled: e.is_cancelled,
                    updated_at: e.updated_at,
                    url: `${window.location.origin}/events/${e.id}`,
                  })),
                  "Ignite Schedule",
                  "ignite-schedule",
                ).then(() => {
                  toast({ title: "Schedule exported" });
                }).catch((err) => {
                  toast({ title: "Couldn't export", description: (err as Error).message, variant: "destructive" });
                });
                return;
              }
              setCreateMenuOpen(true);
            }}
            aria-label="Create"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Action sheet — primary "+" menu */}
      <Sheet open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle>Schedule actions</SheetTitle>
            <SheetDescription>Create or import events, or export to your calendar.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              variant="default"
              className="w-full justify-start h-12 gap-3"
              onClick={() => {
                setCreateMenuOpen(false);
                navigate("/events/new");
              }}
            >
              <Plus className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="text-sm font-semibold">Create Event</span>
                <span className="text-[11px] opacity-80">Training, game or social</span>
              </div>
            </Button>

            {(isAppAdmin || userRoles?.some(r => ["club_admin", "team_admin", "coach", "committee_member"].includes(r.role))) && (
              <Button
                variant="outline"
                className="w-full justify-start h-12 gap-3"
                onClick={() => {
                  setCreateMenuOpen(false);
                  navigate("/events/import");
                }}
              >
                <FileSpreadsheet className="h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold">Import Fixtures</span>
                  <span className="text-[11px] text-muted-foreground">From CSV or Excel</span>
                </div>
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Collapsible Filter Panel */}
      <Collapsible open={showFilters}>
        <CollapsibleContent>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ClubTeamFilter
                clubs={userClubs || []}
                teams={userTeams || []}
                selectedClubId={clubFilter || "all"}
                selectedTeamId={teamFilter || "all"}
                onClubChange={handleClubChange}
                onTeamChange={handleTeamChange}
                showClubFilter={(userClubs?.length || 0) > 1}
                showTeamFilter={(userTeams?.length || 0) > 0}
                getSportEmoji={getSportEmoji}
              />

            </div>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* View Toggle + Add to calendar */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 rounded-lg bg-muted p-1 gap-1">
          <button
            onClick={() => handleViewModeChange("list")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
          >
            <List className="h-4 w-4" />
            List
          </button>
          <button
            onClick={() => handleViewModeChange("calendar")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === "calendar"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Calendar view"
            aria-pressed={viewMode === "calendar"}
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </button>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={!upcomingEvents?.length}
          aria-label="Add upcoming events to your calendar"
          title="Add to your calendar"
          onClick={async () => {
            if (!upcomingEvents?.length) {
              toast({ title: "No upcoming events to export" });
              return;
            }
            try {
              await exportEventsIcs(
                upcomingEvents.map((e: any) => ({
                  id: e.id,
                  title: e.title,
                  type: e.type,
                  event_date: e.event_date,
                  start_time: e.start_time,
                  end_time: e.end_time,
                  description: e.description,
                  location_name: e.location_name,
                  address: e.address,
                  suburb: e.suburb,
                  state: e.state,
                  postcode: e.postcode,
                  is_cancelled: e.is_cancelled,
                  updated_at: e.updated_at,
                  url: `${window.location.origin}/events/${e.id}`,
                })),
                "Ignite Schedule",
                "ignite-schedule",
              );
              toast({
                title: "Schedule exported",
                description: `Open the file to add ${upcomingEvents.length} event${upcomingEvents.length === 1 ? "" : "s"} to your calendar.`,
              });
            } catch (err) {
              toast({ title: "Couldn't export schedule", description: (err as Error).message, variant: "destructive" });
            }
          }}
        >
          <CalendarPlus className="h-4 w-4" />
        </Button>
      </div>

      {/* Filter Pills */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
        {(["all", "game", "training", "social"] as const).map((type) => (
          <Button
            key={type}
            variant={filter === type ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(type)}
            className="shrink-0"
            aria-label={`Filter by ${type === "all" ? "all events" : type}`}
            aria-pressed={filter === type}
          >
            {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
          </Button>
        ))}
      </div>

      {viewMode === "calendar" ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                modifiers={{
                  hasEvent: eventDates,
                }}
                components={{
                  DayContent: ({ date }) => {
                    const dayEvents = events?.filter((e) => isSameDay(parseISO(e.event_date), date)) || [];
                    const gameCount = dayEvents.filter(e => e.type === 'game').length;
                    const trainingCount = dayEvents.filter(e => e.type === 'training').length;
                    const socialCount = dayEvents.filter(e => e.type === 'social').length;
                    const dots: { color: string }[] = [];
                    for (let i = 0; i < Math.min(gameCount, 2); i++) dots.push({ color: 'bg-destructive' });
                    for (let i = 0; i < Math.min(trainingCount, 2); i++) dots.push({ color: 'bg-primary' });
                    for (let i = 0; i < Math.min(socialCount, 2); i++) dots.push({ color: 'bg-warning' });
                    const totalCount = dayEvents.length;
                    const showPlus = totalCount > 3;
                    
                    return (
                      <div className="relative flex items-center justify-center w-full h-full">
                        <span>{date.getDate()}</span>
                        {totalCount > 0 && (
                          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                            {dots.slice(0, 3).map((dot, i) => (
                              <div key={i} className={`w-1 h-1 rounded-full ${dot.color}`} />
                            ))}
                            {showPlus && (
                              <span className="text-[6px] text-muted-foreground font-bold leading-none">+</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  },
                }}
                className="rounded-md w-full"
              />
            </CardContent>
          </Card>

          {selectedDate && (
            <ClubDaySummary
              selectedDate={selectedDate}
              clubIds={
                clubFilter
                  ? [clubFilter]
                  : (userMemberships?.clubIds || [])
              }
              myTeamIds={userMemberships?.teamIds || []}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Day strip — tap a day to filter the list to just that day */}
          <ScheduleDateStrip
            selectedDate={listSelectedDate}
            onSelectDate={(d) => {
              setListSelectedDate(d);
              if (d) setStripWeekAnchor(d);
            }}
            daysWithEvents={daysWithEventsKeySet}
            weekAnchor={stripWeekAnchor}
            onShiftWeek={(delta) => {
              setStripWeekAnchor((prev) => {
                const next = new Date(prev);
                next.setDate(next.getDate() + delta);
                return next;
              });
            }}
          />

          {listSelectedDate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">
                  {format(listSelectedDate, "EEEE, MMMM d")}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setListSelectedDate(null)}>
                  Clear
                </Button>
              </div>
              {listDayEvents && listDayEvents.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-center">
                    <p className="text-muted-foreground text-sm">Nothing scheduled this day</p>
                  </CardContent>
                </Card>
              ) : (
                listDayEvents?.map((event) => (
                  <EventCard key={event.id} event={event} isAdmin={isAdminForEvent(event)} hasViewed={viewedEventIds?.has(event.id) ?? true} />
                ))
              )}
            </div>
          ) : (
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="upcoming" className="flex-1">Upcoming</TabsTrigger>
                <TabsTrigger value="past" className="flex-1">Past</TabsTrigger>
              </TabsList>

          <TabsContent value="upcoming" className="mt-4 space-y-3">
            {upcomingEvents?.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No upcoming events</p>
                </CardContent>
              </Card>
            ) : (
              upcomingEvents?.map((event) => (
                <EventCard key={event.id} event={event} isAdmin={isAdminForEvent(event)} hasViewed={viewedEventIds?.has(event.id) ?? true} />
              ))
            )}
          </TabsContent>

          <TabsContent value="past" className="mt-4 space-y-3">
            {pastEvents?.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">No past events</p>
                </CardContent>
              </Card>
            ) : (
              pastEvents?.map((event) => (
                <EventCard key={event.id} event={event} isAdmin={isAdminForEvent(event)} hasViewed={viewedEventIds?.has(event.id) ?? true} />
              ))
            )}
          </TabsContent>
            </Tabs>
          )}
        </div>
      )}

      {/* Sponsor/Ad Carousel */}
      <SponsorOrAdCarousel location="events" activeClubFilter={activeClubFilter} />
    </div>
  );
}
