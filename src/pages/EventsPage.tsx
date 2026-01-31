import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar as CalendarIcon, MapPin, Clock, Plus, List, CalendarDays, Pencil, Trash2, XCircle, Bell, Repeat, Upload, Eye, Filter } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageLoading } from "@/components/ui/page-loading";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
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

const eventTypeColors: Record<EventType, string> = {
  game: "bg-destructive/20 text-destructive",
  training: "bg-primary/20 text-primary",
  social: "bg-warning/20 text-warning",
};

export default function EventsPage() {
  const { user, profile, refreshProfile } = useAuth();
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
  });

  // Fetch teams for the selected club (or all user's teams if no club selected)
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
  });

  // Get user's accessible team, club, and mini league IDs for event filtering
  const { data: userMemberships } = useQuery({
    queryKey: ["user-memberships-for-events", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);
      
      if (!roles) return { teamIds: [], clubIds: [], leagueAdminClubIds: [], miniLeagueIds: [] };
      
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id) as string[];
      const clubIds = new Set<string>();
      const leagueAdminClubIds = new Set<string>();
      
      // Direct club roles
      roles.forEach(r => {
        if (r.club_id) {
          clubIds.add(r.club_id);
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
        leagueAdminClubIds: Array.from(leagueAdminClubIds),
        miniLeagueIds 
      };
    },
    enabled: !!user,
  });

  const { data: events, isLoading } = useQuery({
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
      // - Team events: user must be a member of that team
      // - Mini League events: user must be a league admin or have a player in that league
      // - Club-wide events (no team_id, no mini_league_id): user must be a member of that club
      filteredData = filteredData.filter(event => {
        if (event.mini_league_id) {
          // Mini League event - user must be league admin or have a player in this league
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          // Team event - user must be a member of this team
          return teamIds.includes(event.team_id);
        } else {
          // Club-wide event - user must be a member of this club
          return clubIds.includes(event.club_id);
        }
      });
      
      return filteredData as Event[];
    },
    enabled: !!user && !!userMemberships,
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
  });

  // Get user's admin roles for clubs/teams
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

  if (isLoading) {
    return <PageLoading message="Loading events..." />;
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
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

              {(isAppAdmin || userRoles?.some(r => ["club_admin", "team_admin", "coach", "committee_member"].includes(r.role))) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to="/events/import">
                      <Button size="icon" variant="outline" className="h-10 w-10 sm:h-9 sm:w-9">
                        <Upload className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>Import Fixtures</TooltipContent>
                </Tooltip>
              )}
            </div>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Filter Pills with View Toggle */}
      <div className="flex items-center justify-between gap-2 -mx-4 px-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(["all", "game", "training", "social"] as const).map((type) => (
            <Button
              key={type}
              variant={filter === type ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(type)}
              className="shrink-0"
            >
              {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
            </Button>
          ))}
        </div>
        <ToggleGroup 
          type="single" 
          value={viewMode} 
          onValueChange={(value) => value && handleViewModeChange(value as "list" | "calendar")}
          className="bg-muted p-1 rounded-lg shrink-0"
        >
          <ToggleGroupItem 
            value="list" 
            aria-label="List view" 
            className="h-8 w-8 p-0 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md"
          >
            <List className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="calendar" 
            aria-label="Calendar view" 
            className="h-8 w-8 p-0 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md"
          >
            <CalendarDays className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
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
                      <div className="relative flex flex-col items-center justify-center w-full h-full">
                        <span>{date.getDate()}</span>
                        {totalCount > 0 && (
                          <div className="flex gap-0.5 mt-0.5">
                            {dots.slice(0, 3).map((dot, i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full ${dot.color}`} />
                            ))}
                            {showPlus && (
                              <span className="text-[8px] text-muted-foreground font-bold">+{totalCount - 3}</span>
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

function EventCard({ event, isAdmin, hasViewed = true }: { event: Event; isAdmin: boolean; hasViewed?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [nonRsvpCount, setNonRsvpCount] = useState<number | null>(null);

  const isRecurring = event.is_recurring || event.parent_event_id;

  // Check if team or club has Pro subscription
  const { data: hasPro } = useQuery({
    queryKey: ["event-pro-status", event.team_id, event.club_id],
    queryFn: async () => {
      // Check team subscription first
      if (event.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro === true || teamSub?.is_pro_football === true) {
          return true;
        }
      }
      // Check club subscription
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football")
        .eq("club_id", event.club_id)
        .maybeSingle();
      return clubSub?.is_pro === true || clubSub?.is_pro_football === true;
    },
  });

  const canSendReminders = hasPro === true;

  const deleteEventMutation = useMutation({
    mutationFn: async (deleteType: 'single' | 'series') => {
      if (deleteType === 'series' && event.parent_event_id) {
        await supabase.from("events").delete().eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").delete().eq("id", event.parent_event_id);
      } else if (deleteType === 'series' && event.is_recurring) {
        await supabase.from("events").delete().eq("parent_event_id", event.id);
        await supabase.from("events").delete().eq("id", event.id);
      } else {
        const { error } = await supabase.from("events").delete().eq("id", event.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      toast({ title: "Failed to delete event", variant: "destructive" });
    },
  });

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      // First, update the event(s) as cancelled
      if (cancelType === 'series' && event.parent_event_id) {
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", event.parent_event_id);
      } else if (cancelType === 'series' && event.is_recurring) {
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", event.id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", event.id);
      } else {
        const { error } = await supabase.from("events").update({ is_cancelled: true }).eq("id", event.id);
        if (error) throw error;
      }

      // Get member count for toast feedback - handle mini-league events differently
      let uniqueMembers: string[] = [];
      
      if (event.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = [...new Set(members?.map(m => m.user_id) || [])];
      }

      // Always post cancellation message to team, club, or mini-league chat
      if (user) {
        const eventUrl = `${window.location.origin}/events/${event.id}`;
        const cancellationMessage = customMessage 
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventUrl}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventUrl}`;
        
        if (event.mini_league_id) {
          // Post to mini-league chat group
          const { data: chatGroup } = await supabase
            .from("chat_groups")
            .select("id")
            .eq("mini_league_id", event.mini_league_id)
            .maybeSingle();
          
          if (chatGroup) {
            await supabase.from("group_messages").insert({
              group_id: chatGroup.id,
              author_id: user.id,
              text: cancellationMessage,
            });
          }
        } else if (event.team_id) {
          await supabase.from("team_messages").insert({
            team_id: event.team_id,
            author_id: user.id,
            text: cancellationMessage,
          });
        } else {
          await supabase.from("club_messages").insert({
            club_id: event.club_id,
            author_id: user.id,
            text: cancellationMessage,
          });
        }
      }

      // Send push notifications if enabled
      if (sendPushNotification) {
        const notificationMessage = customMessage 
          ? `"${event.title}" has been cancelled. ${customMessage}`
          : `"${event.title}" has been cancelled.`;
        
        const notifications = uniqueMembers.map(userId => ({
          user_id: userId,
          type: "event_cancelled",
          message: notificationMessage,
          related_id: event.id,
        }));
        await supabase.from("notifications").insert(notifications);
      }

      return uniqueMembers.length;
    },
    onSuccess: () => {
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      toast({ title: "Failed to cancel event", variant: "destructive" });
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      // Get all RSVPs for this event
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", event.id);
      
      const rsvpUserIds = rsvps?.map(r => r.user_id) || [];
      
      // Get all members who should RSVP (team or club members)
      let memberQuery = supabase.from("user_roles").select("user_id");
      if (event.team_id) {
        memberQuery = memberQuery.eq("team_id", event.team_id);
      } else {
        memberQuery = memberQuery.eq("club_id", event.club_id);
      }
      
      const { data: members } = await memberQuery;
      const allMemberIds = [...new Set(members?.map(m => m.user_id) || [])];
      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(id => !rsvpUserIds.includes(id));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for existing notifications to avoid duplicates
      const { data: existingNotifications } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", event.id)
        .in("user_id", nonRsvpMembers);
      
      const existingNotificationUserIds = existingNotifications?.map(n => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter(id => !existingNotificationUserIds.includes(id));
      
      if (membersToNotify.length === 0) {
        throw new Error("All members have already been reminded!");
      }
      
      // Create notifications for members who haven't been reminded
      const notifications = membersToNotify.map(userId => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event.title}"`,
        related_id: event.id,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      
      return membersToNotify.length;
    },
    onSuccess: () => {
      // Silently succeed without toast
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  return (
    <Card className={`hover:border-primary/50 transition-colors ${event.is_cancelled ? "opacity-60" : ""}`}>
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className={eventTypeColors[event.type]} variant="secondary">
              {event.type}
            </Badge>
            {hasPro && isAdmin && !hasViewed && !event.is_cancelled && (
              <Badge variant="default" className="gap-1 bg-primary text-primary-foreground">
                <Eye className="h-3 w-3" />
                New
              </Badge>
            )}
            {event.is_cancelled && (
              <Badge variant="destructive">Cancelled</Badge>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span>{getSportEmoji(event.clubs.sport)}</span>
              {event.clubs.name}
            </span>
            <div className="flex-1" />
            {isAdmin && (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {!event.is_cancelled && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/events/${event.id}/edit`);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {canSendReminders && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-primary"
                        disabled={remindMutation.isPending}
                        onClick={async (e) => {
                          e.preventDefault();
                          // Fetch count of non-RSVP members first
                          const { data: rsvps } = await supabase
                            .from("rsvps")
                            .select("user_id")
                            .eq("event_id", event.id);
                          
                          const rsvpUserIds = rsvps?.map(r => r.user_id) || [];
                          
                          let memberQuery = supabase.from("user_roles").select("user_id");
                          if (event.team_id) {
                            memberQuery = memberQuery.eq("team_id", event.team_id);
                          } else {
                            memberQuery = memberQuery.eq("club_id", event.club_id);
                          }
                          
                          const { data: members } = await memberQuery;
                          const allMemberIds = [...new Set(members?.map(m => m.user_id) || [])];
                          const count = allMemberIds.filter(id => !rsvpUserIds.includes(id)).length;
                          
                          setNonRsvpCount(count);
                          setRemindDialogOpen(true);
                        }}
                      >
                        <Bell className="h-4 w-4" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8 text-warning"
                      onClick={(e) => {
                        e.preventDefault();
                        setCancelDialogOpen(true);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>

                {/* Cancel Dialog */}
                {isRecurring ? (
                  <RecurringCancelEventDialog
                    open={cancelDialogOpen}
                    onOpenChange={setCancelDialogOpen}
                    eventTitle={event.title}
                    teamId={event.team_id}
                    clubId={event.club_id}
                    miniLeagueId={event.mini_league_id}
                    onSingleAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })}
                    onSeriesAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: 'series', customMessage, sendPushNotification })}
                    isPending={cancelEventMutation.isPending}
                  />
                ) : (
                  <CancelEventConfirmDialog
                    open={cancelDialogOpen}
                    onOpenChange={setCancelDialogOpen}
                    eventId={event.id}
                    eventTitle={event.title}
                    teamId={event.team_id}
                    clubId={event.club_id}
                    miniLeagueId={event.mini_league_id}
                    onConfirm={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })}
                    isPending={cancelEventMutation.isPending}
                  />
                )}

                {/* Delete Dialog */}
                {isRecurring ? (
                  <RecurringEventActionDialog
                    open={deleteDialogOpen}
                    onOpenChange={setDeleteDialogOpen}
                    title="Delete Event?"
                    description="This will permanently delete the event(s). This action cannot be undone."
                    actionLabel="Delete"
                    actionVariant="destructive"
                    onSingleAction={() => deleteEventMutation.mutate('single')}
                    onSeriesAction={() => deleteEventMutation.mutate('series')}
                    isPending={deleteEventMutation.isPending}
                  />
                ) : (
                  <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Event?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete this event. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteEventMutation.mutate('single')} 
                          className="bg-destructive text-destructive-foreground"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Remind Dialog */}
                <AlertDialog open={remindDialogOpen} onOpenChange={setRemindDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Send Reminders?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {nonRsvpCount === 0 
                          ? "Everyone has already RSVPed to this event!"
                          : `This will send a reminder notification to ${nonRsvpCount} member${nonRsvpCount === 1 ? '' : 's'} who haven't RSVPed yet.`
                        }
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      {nonRsvpCount !== 0 && (
                        <AlertDialogAction 
                          onClick={() => remindMutation.mutate()}
                          disabled={remindMutation.isPending}
                        >
                          Send Reminders
                        </AlertDialogAction>
                      )}
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
          <Link to={`/events/${event.id}`} className="block">
            <h3 className={`font-semibold ${event.is_cancelled ? "line-through" : ""}`}>
              {event.title}
              {event.type === "game" && event.opponent && (
                <span className="font-normal text-muted-foreground"> vs {event.opponent}</span>
              )}
            </h3>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {format(parseISO(event.event_date), "EEE, MMM d 'at' h:mm a")}
              </span>
              {event.suburb && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {event.suburb}
                </span>
              )}
            </div>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
