import { useState, useMemo, useEffect } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Plus, List, CalendarDays, Repeat, FileSpreadsheet, Filter } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, startOfDay, isSameDay, subHours } from "date-fns";
import { getSportEmoji } from "@/lib/sportEmojis";
import { useClubTheme } from "@/hooks/useClubTheme";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { useUserEventViews } from "@/hooks/useEventViews";

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
  usePageTitle("Schedule");
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
  const [showFilters, setShowFilters] = useState(false);
  
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
      params.delete("team"); // Reset team filter when club theme changes
    } else {
      params.delete("club");
      params.delete("team");
    }
    setSearchParams(params, { replace: true });
  }, [activeClubFilter]);

  // Fetch user's clubs (clubs they are members of)
  const { data: userClubs } = useQuery({
    queryKey: ["user-clubs-for-filter", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      
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
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);
      
      if (!roles) return { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [] };
      
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
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teams?.forEach(t => clubIds.add(t.club_id));
      }
      
      // Get mini league IDs where user is a parent (has a player)
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);
      
      const miniLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      
      // Also get mini leagues where user is league admin via club_admin role
      const { data: adminLeagues } = await supabase
        .from("mini_leagues")
        .select("id")
        .in("club_id", Array.from(leagueAdminClubIds));
      
      // Add leagues where user is admin
      adminLeagues?.forEach(l => {
        if (!miniLeagueIds.includes(l.id)) {
          miniLeagueIds.push(l.id);
        }
      });
      
      return { 
        teamIds, 
        clubIds: Array.from(clubIds), 
        clubAdminClubIds: Array.from(clubAdminClubIds),
        leagueAdminClubIds: Array.from(leagueAdminClubIds),
        miniLeagueIds 
      };
    },
    enabled: !!user,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });
  const { data: events, isLoading, isFetching } = useQuery({
    queryKey: ["events", user?.id, filter, teamFilter, clubFilter, userMemberships?.teamIds, userMemberships?.clubIds, userMemberships?.miniLeagueIds],
    queryFn: async () => {
      if (!userMemberships) return [];
      
      const { teamIds, clubIds, miniLeagueIds } = userMemberships;
      if (teamIds.length === 0 && clubIds.length === 0) return [];
      
      let query = supabase
        .from("events")
        .select(`
          id,
          title,
          type,
          event_date,
          address,
          suburb,
          location_name,
          club_id,
          team_id,
          mini_league_id,
          is_cancelled,
          is_recurring,
          parent_event_id,
          opponent,
          updated_at,
          teams (name),
          clubs (name, sport)
        `)
        .order("event_date", { ascending: true });

      if (filter !== "all") {
        query = query.eq("type", filter);
      }

      if (clubFilter) {
        query = query.eq("club_id", clubFilter);
      }

      if (teamFilter) {
        query = query.eq("team_id", teamFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Filter out cancelled events older than 48 hours
      const cutoffTime = subHours(new Date(), 48);
      let filteredData = (data as (Event & { updated_at: string; mini_league_id: string | null })[]).filter(event => {
        if (!event.is_cancelled) return true;
        // Keep cancelled events if they were cancelled within the last 48 hours
        const updatedAt = new Date(event.updated_at);
        return updatedAt > cutoffTime;
      });
      
      // Filter to only show events user is invited to:
      // - Team events: user must be a member of that team OR a club admin of the team's club
      // - Mini League events: user must be a league admin or have a player in that league
      // - Club-wide events (no team_id, no mini_league_id): user must be a member of that club
      const { clubAdminClubIds } = userMemberships;
      filteredData = filteredData.filter(event => {
        if (event.mini_league_id) {
          // Mini League event - user must be league admin or have a player in this league
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          // Team event - user must be a member of this team OR a club admin of the team's club
          return teamIds.includes(event.team_id) || clubAdminClubIds.includes(event.club_id);
        } else {
          // Club-wide event - user must be a member of this club
          return clubIds.includes(event.club_id);
        }
      });
      
      // Limit recurring series to next 3 upcoming occurrences
      const { filterRecurringEvents } = await import("@/lib/filterRecurringEvents");
      return filterRecurringEvents(filteredData) as Event[];
    },
    enabled: !!user && !!userMemberships,
    staleTime: 60000, // Cache for 1 minute to prevent flash on resume
    placeholderData: (prev) => prev, // Keep previous data while refetching
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
      (["club_admin", "team_admin", "coach"].includes(r.role)) &&
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

  // Only show full-page loading on first ever load (no cached data).
  // Use isLoading (not isFetching) to avoid flash on background refetch/resume.
  if (isLoading && !events && !upcomingEvents && !pastEvents) {
    return <PageLoading message="Loading events..." />;
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex items-center gap-6">
          {/* Filter button - only show if there are filters to display */}
          {((userClubs?.length || 0) > 1 || (userTeams?.length || 0) > 0) && (
            <Button 
              variant={hasActiveFilters ? "default" : "outline"} 
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
              className="relative"
            >
              <Filter className="h-4 w-4" />
              {hasActiveFilters && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          )}
          {(isAppAdmin || userRoles?.some(r => ["club_admin", "team_admin", "coach", "committee_member"].includes(r.role))) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/events/import">
                  <Button size="icon" variant="outline">
                    <FileSpreadsheet className="h-4 w-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Import Fixtures</TooltipContent>
            </Tooltip>
          )}
          {(isAppAdmin || userRoles?.some(r => ["club_admin", "team_admin", "coach", "committee_member"].includes(r.role))) && (
            <Link to="/events/new">
              <Button size="icon" variant="default">
                <Plus className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

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

      {/* View Toggle - Full width tabs */}
      <div className="flex rounded-lg bg-muted p-1 gap-1">
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
            <div className="space-y-3">
              <h2 className="font-semibold">
                Events on {format(selectedDate, "EEEE, MMMM d")}
              </h2>
              {selectedDateEvents?.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-center">
                    <p className="text-muted-foreground">No events on this date</p>
                  </CardContent>
                </Card>
              ) : (
                selectedDateEvents?.map((event) => (
                  <EventCard key={event.id} event={event} isAdmin={isAdminForEvent(event)} hasViewed={viewedEventIds?.has(event.id) ?? true} />
                ))
              )}
            </div>
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

      {/* Sponsor/Ad Carousel */}
      <SponsorOrAdCarousel location="events" activeClubFilter={activeClubFilter} />
    </div>
  );
}
