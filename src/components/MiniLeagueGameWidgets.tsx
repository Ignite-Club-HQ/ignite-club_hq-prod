import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Timer, Play, Pause, ExternalLink, Users, LayoutGrid, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

// Lazy load PitchBoard for performance
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  lastUpdateTime: number;
  isGameFinished?: boolean;
}

interface ActiveMiniLeagueMatch {
  id: string;
  name: string;
  eventId: string;
  eventTitle: string;
  leagueId: string;
  leagueName: string;
  clubId: string;
  timerState: TimerState | null;
  pitchState: any;
  teamAColor: string;
  teamBColor: string;
  players: { id: string; name: string; team: "a" | "b" | null }[];
  teamAScore: number;
  teamBScore: number;
  isAdmin: boolean;
  isSubsManager: boolean;
  minutesPerHalf: number;
}

interface MiniLeagueGameWidgetsProps {
  activeClubFilter?: string | null;
}

function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[60] bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading Pitch Board...</p>
      </div>
    </div>
  );
}

export function MiniLeagueGameWidgets({ activeClubFilter }: MiniLeagueGameWidgetsProps) {
  const { user } = useAuth();
  const [activePitchBoard, setActivePitchBoard] = useState<ActiveMiniLeagueMatch | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Fetch user's mini league memberships (as parent or admin)
  const { data: userLeagueMemberships } = useQuery({
    queryKey: ["user-league-memberships", user?.id],
    queryFn: async () => {
      // Get leagues where user is a parent
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);

      // Get leagues where user is admin via club_admin, league_admin, or coach role
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "coach", "app_admin"]);

      const isAppAdmin = adminRoles?.some(r => r.role === "app_admin");
      const adminClubIds = adminRoles?.filter(r => r.club_id).map(r => r.club_id) as string[] || [];

      let adminLeagueIds: string[] = [];
      if (adminClubIds.length > 0 || isAppAdmin) {
        let query = supabase.from("mini_leagues").select("id");
        if (!isAppAdmin && adminClubIds.length > 0) {
          query = query.in("club_id", adminClubIds);
        }
        const { data: adminLeagues } = await query;
        adminLeagueIds = adminLeagues?.map(l => l.id) || [];
      }

      const parentLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      const allLeagueIds = [...new Set([...parentLeagueIds, ...adminLeagueIds])];

      return {
        parentLeagueIds,
        adminLeagueIds,
        allLeagueIds,
        isAppAdmin,
      };
    },
    enabled: !!user,
    staleTime: 30000,
  });

  // Fetch active mini league matches (where timer_state has isRunning = true)
  const { data: activeMatches = [], refetch } = useQuery({
    queryKey: ["active-mini-league-matches", userLeagueMemberships?.allLeagueIds, activeClubFilter],
    queryFn: async () => {
      if (!userLeagueMemberships?.allLeagueIds?.length) return [];

      // Get events from user's leagues that have active matches
      const { data: events, error: eventsError } = await supabase
        .from("events")
        .select("id, title, mini_league_id, club_id")
        .in("mini_league_id", userLeagueMemberships.allLeagueIds)
        .not("mini_league_id", "is", null);

      if (eventsError || !events?.length) return [];

      // Filter by club if active filter is set
      const filteredEvents = activeClubFilter
        ? events.filter(e => e.club_id === activeClubFilter)
        : events;

      if (!filteredEvents.length) return [];

      // Get event groups with timer_state
      const { data: groups, error: groupsError } = await supabase
        .from("event_groups")
        .select("*")
        .in("event_id", filteredEvents.map(e => e.id))
        .not("timer_state", "is", null);

      if (groupsError || !groups?.length) return [];

      // Get league names and settings
      const leagueIds = [...new Set(filteredEvents.map(e => e.mini_league_id).filter(Boolean))];
      const { data: leagues } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, minutes_per_half")
        .in("id", leagueIds as string[]);

      const leagueMap = new Map(leagues?.map(l => [l.id, l]) || []);

      // Get players for each group
      const activeMatches: ActiveMiniLeagueMatch[] = [];
      
      for (const group of groups) {
        // Cast timer_state properly
        const rawTimerState = group.timer_state as unknown as TimerState | null;
        
        // Only show matches that are actively in progress (timer running or has started)
        if (!rawTimerState || typeof rawTimerState !== 'object') continue;
        
        const timerState = rawTimerState;
        
        // Skip if game is finished
        if (timerState.isGameFinished) continue;
        
        // Skip if timer hasn't started yet
        const hasStarted = timerState.elapsedSeconds > 0 || timerState.isRunning || timerState.currentHalf > 1;
        if (!hasStarted) continue;

        const event = filteredEvents.find(e => e.id === group.event_id);
        if (!event) continue;

        const league = leagueMap.get(event.mini_league_id!);
        if (!league) continue;

        // Get players for this match
        const { data: playerLinks } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", group.id);

        const playerIds = playerLinks?.map(p => p.player_id) || [];
        let players: { id: string; name: string; team: "a" | "b" | null }[] = [];

        if (playerIds.length > 0) {
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("id, name")
            .in("id", playerIds);

          players = (playersData || []).map(p => ({
            id: p.id,
            name: p.name,
            team: playerLinks?.find(pl => pl.player_id === p.id)?.team as "a" | "b" | null,
          }));
        }

        // Calculate scores from pitch_state goals
        const pitchState = group.pitch_state as any;
        const goals = pitchState?.goals || [];
        const teamAScore = goals.filter((g: any) => g.teamSide === "a").length;
        const teamBScore = goals.filter((g: any) => g.teamSide === "b").length;

        // Check if user is admin for this league
        const isAdmin = userLeagueMemberships.isAppAdmin || 
          userLeagueMemberships.adminLeagueIds.includes(league.id);

        // Check if user has "Subs Manager" duty for this specific group
        let isSubsManagerForGroup = false;
        if (!isAdmin && user) {
          const { data: subsManagerDuty } = await supabase
            .from("event_group_duties")
            .select("id")
            .eq("group_id", group.id)
            .eq("name", "Subs Manager")
            .eq("assigned_to", user.id)
            .maybeSingle();
          isSubsManagerForGroup = !!subsManagerDuty;
        }

        activeMatches.push({
          id: group.id,
          name: group.name,
          eventId: event.id,
          eventTitle: event.title,
          leagueId: league.id,
          leagueName: league.name,
          clubId: league.club_id,
          timerState,
          pitchState: pitchState || {},
          teamAColor: group.team_a_color || "#ef4444",
          teamBColor: group.team_b_color || "#3b82f6",
          players,
          teamAScore,
          teamBScore,
          isAdmin,
          isSubsManager: isSubsManagerForGroup,
          minutesPerHalf: league.minutes_per_half || 10,
        });
      }

      return activeMatches;
    },
    enabled: !!user && !!userLeagueMemberships?.allLeagueIds?.length,
    refetchInterval: 5000, // Refresh every 5 seconds to get updated timer states
  });

  const formatTime = useCallback((seconds: number, half: 1 | 2, minutesPerHalf: number) => {
    const totalSeconds = half === 1 ? seconds : (minutesPerHalf * 60) + seconds;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const calculateCurrentTime = (timerState: TimerState) => {
    let currentElapsed = timerState.elapsedSeconds;
    if (timerState.isRunning && timerState.lastUpdateTime) {
      const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
      currentElapsed = Math.min(timerState.elapsedSeconds + secondsPassed, timerState.minutesPerHalf * 60);
    }
    return currentElapsed;
  };

  const openPitchBoard = (match: ActiveMiniLeagueMatch) => {
    setActivePitchBoard(match);
  };

  // Limit displayed matches
  const displayedMatches = expanded ? activeMatches : activeMatches.slice(0, 2);
  const hasMoreMatches = activeMatches.length > 2;

  if (!activeMatches.length) return null;

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            Live Matches
          </h2>
          {hasMoreMatches && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground"
            >
              {expanded ? (
                <>Show Less <ChevronUp className="h-4 w-4 ml-1" /></>
              ) : (
                <>+{activeMatches.length - 2} more <ChevronDown className="h-4 w-4 ml-1" /></>
              )}
            </Button>
          )}
        </div>

        <div className="grid gap-3">
          {displayedMatches.map((match) => {
            const timerState = match.timerState;
            const currentTime = timerState ? calculateCurrentTime(timerState) : 0;

            return (
              <Card 
                key={match.id} 
                className="border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
                onClick={() => openPitchBoard(match)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          {match.leagueName}
                        </Badge>
                        <span className="text-sm font-medium truncate">{match.name}</span>
                        {timerState?.isRunning && (
                          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                        )}
                      </div>
                      
                      {/* Score display */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: match.teamAColor }}
                          />
                          <span className="font-bold text-lg">{match.teamAScore}</span>
                        </div>
                        <span className="text-muted-foreground">-</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg">{match.teamBScore}</span>
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: match.teamBColor }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Timer display */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Timer className={`h-4 w-4 ${timerState?.isRunning ? 'text-primary animate-pulse' : ''}`} />
                          <span>{timerState?.currentHalf === 1 ? "1H" : "2H"}</span>
                        </div>
                        {timerState && (
                          <span className="font-mono text-lg font-bold text-primary">
                            {formatTime(currentTime, timerState.currentHalf, timerState.minutesPerHalf)}
                          </span>
                        )}
                      </div>
                      <Button 
                        variant="default" 
                        size="icon" 
                        className="h-10 w-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPitchBoard(match);
                        }}
                      >
                        <ExternalLink className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pitch Board Portal */}
      {activePitchBoard && createPortal(
        <Suspense fallback={<LoadingOverlay />}>
          <PitchBoard
            teamId={`event-group-${activePitchBoard.id}`}
            teamName={`${activePitchBoard.leagueName} - ${activePitchBoard.name}`}
            members={activePitchBoard.players.map(p => ({
              id: `player-${p.id}`,
              user_id: p.id,
              role: "player",
              profiles: { display_name: p.name, avatar_url: "" },
            }))}
            onClose={() => {
              setActivePitchBoard(null);
              refetch();
            }}
            miniLeagueTeams={{
              teamAPlayerIds: activePitchBoard.players.filter(p => p.team === "a").map(p => p.id),
              teamBPlayerIds: activePitchBoard.players.filter(p => p.team === "b").map(p => p.id),
              teamAColor: activePitchBoard.teamAColor,
              teamBColor: activePitchBoard.teamBColor,
            }}
            initialTeamSize={(() => {
              const count = activePitchBoard.players.length;
              if (count <= 8) return 4;
              if (count <= 14) return 7;
              if (count <= 18) return 9;
              return 11;
            })()}
            initialMinutesPerHalf={activePitchBoard.minutesPerHalf}
            initialLinkedEventId={activePitchBoard.eventId}
            readOnly={!activePitchBoard.isAdmin && !activePitchBoard.isSubsManager}
            isSubsManager={activePitchBoard.isSubsManager}
          />
        </Suspense>,
        document.body
      )}
    </>
  );
}
