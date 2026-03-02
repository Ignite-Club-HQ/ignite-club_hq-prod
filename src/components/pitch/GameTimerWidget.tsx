import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Pause, Timer, ExternalLink, X, ArrowRightLeft, Clock, UserRoundCheck, ChevronRight } from "lucide-react";
import { Goal } from "./types";

// Active timer key - mirrors the one in GameTimer.tsx
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';
const PITCH_STATE_KEY = "ignite-pitch-board-state";

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: { id: string; name: string; number?: number };
  playerIn: { id: string; name: string; number?: number };
  executed?: boolean;
}

interface PitchBoardState {
  teamId: string;
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  goals?: Goal[];
}

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

const loadActiveTimerState = (): TimerState | null => {
  try {
    const activeRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (!activeRaw) return null;
    const activeState = JSON.parse(activeRaw) as TimerState;
    if (activeState.teamId) {
      const teamKey = getTeamTimerStorageKey(activeState.teamId);
      const teamRaw = localStorage.getItem(teamKey);
      if (teamRaw) return JSON.parse(teamRaw) as TimerState;
      return activeState;
    }
    return activeState;
  } catch (e) {
    console.error('Failed to load active timer state:', e);
  }
  return null;
};

const saveTimerState = (state: TimerState) => {
  try {
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(state));
    if (state.teamId) {
      const teamKey = getTeamTimerStorageKey(state.teamId);
      localStorage.setItem(teamKey, JSON.stringify(state));
    }
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};

interface NextSubInfo {
  playerOut: string;
  playerIn: string;
  isDue: boolean;
  secondsUntil: number;
}

interface GameTimerWidgetProps {
  onOpenPitchBoard?: (teamId: string, teamName: string) => void;
  readOnly?: boolean;
}

export default function GameTimerWidget({ onOpenPitchBoard, readOnly = false }: GameTimerWidgetProps) {
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [homeGoals, setHomeGoals] = useState(0);
  const [awayGoals, setAwayGoals] = useState(0);
  const [nextSub, setNextSub] = useState<NextSubInfo | null>(null);
  const [totalUpcomingSubs, setTotalUpcomingSubs] = useState(0);

  // Load and sync all state
  useEffect(() => {
    const checkState = () => {
      const saved = loadActiveTimerState();
      if (saved) {
        let currentElapsed = saved.elapsedSeconds;
        if (saved.isRunning && saved.lastUpdateTime) {
          const secondsPassed = Math.floor((Date.now() - saved.lastUpdateTime) / 1000);
          currentElapsed = Math.min(saved.elapsedSeconds + secondsPassed, saved.minutesPerHalf * 60);
        }
        setTimerState(saved);
        setDisplaySeconds(currentElapsed);

        // Load pitch state for goals and subs
        try {
          const pitchRaw = localStorage.getItem(PITCH_STATE_KEY);
          if (pitchRaw) {
            const pitchState: PitchBoardState = JSON.parse(pitchRaw);
            
            // Score
            const goals = pitchState.goals || [];
            setHomeGoals(goals.filter(g => !g.isOpponentGoal).length);
            setAwayGoals(goals.filter(g => g.isOpponentGoal).length);
            
            // Next sub
            const unexecutedSubs = pitchState.autoSubPlan?.filter(s => !s.executed) || [];
            setTotalUpcomingSubs(unexecutedSubs.length);
            
            if (pitchState.autoSubActive && unexecutedSubs.length > 0 && saved.isRunning) {
              const sorted = [...unexecutedSubs].sort((a, b) => {
                if (a.half !== b.half) return a.half - b.half;
                return a.time - b.time;
              });
              
              const minutesPerHalf = saved.minutesPerHalf || 20;
              const currentHalf = saved.currentHalf || 1;
              const currentTotalSeconds = currentHalf === 1 
                ? currentElapsed 
                : (minutesPerHalf * 60) + currentElapsed;
              
              const first = sorted[0];
              const subTotalSeconds = first.half === 1 ? first.time : (minutesPerHalf * 60) + first.time;
              const isDue = subTotalSeconds <= currentTotalSeconds;
              const secondsUntil = Math.max(0, subTotalSeconds - currentTotalSeconds);
              
              setNextSub({
                playerOut: first.playerOut.name,
                playerIn: first.playerIn.name,
                isDue,
                secondsUntil,
              });
            } else {
              setNextSub(null);
            }
          } else {
            setHomeGoals(0);
            setAwayGoals(0);
            setNextSub(null);
            setTotalUpcomingSubs(0);
          }
        } catch {
          // ignore
        }
      } else {
        setTimerState(null);
      }
    };

    checkState();
    const interval = setInterval(checkState, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = useCallback((seconds: number, half: 1 | 2, minutesPerHalf: number) => {
    const totalSeconds = half === 1 ? seconds : (minutesPerHalf * 60) + seconds;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const toggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!timerState) return;
    const newState = {
      ...timerState,
      isRunning: !timerState.isRunning,
      lastUpdateTime: Date.now(),
      elapsedSeconds: displaySeconds,
    };
    saveTimerState(newState);
    setTimerState(newState);
  };

  const handleOpenPitchBoard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerState?.teamId && timerState?.teamName && onOpenPitchBoard) {
      onOpenPitchBoard(timerState.teamId, timerState.teamName);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem(ACTIVE_TIMER_KEY);
    if (timerState?.teamId) {
      localStorage.removeItem(getTeamTimerStorageKey(timerState.teamId));
    }
    const pitchStateRaw = localStorage.getItem('pitch-board-state');
    if (pitchStateRaw) {
      try {
        const pitchState = JSON.parse(pitchStateRaw);
        pitchState.autoSubPlan = [];
        pitchState.autoSubActive = false;
        pitchState.autoSubPaused = false;
        localStorage.setItem('pitch-board-state', JSON.stringify(pitchState));
      } catch { /* ignore */ }
    }
    localStorage.removeItem('pitch-board-state');
    setTimerState(null);
  };

  // Don't show if no timer state, timer hasn't started, or game has concluded
  const isGameConcluded = timerState?.currentHalf === 2 && displaySeconds >= (timerState?.minutesPerHalf || 0) * 60;
  if (!timerState || (timerState.elapsedSeconds === 0 && !timerState.isRunning && timerState.currentHalf === 1) || isGameConcluded) {
    return null;
  }

  const halfLabel = timerState.currentHalf === 1 ? "1st Half" : "2nd Half";
  const hasScore = homeGoals > 0 || awayGoals > 0;

  const formatSubCountdown = () => {
    if (!nextSub) return "";
    if (nextSub.isDue) return "Sub due now";
    const mins = Math.floor(nextSub.secondsUntil / 60);
    const secs = nextSub.secondsUntil % 60;
    if (mins > 0) return `Sub in ${mins}:${secs.toString().padStart(2, '0')}`;
    return `Sub in ${secs}s`;
  };

  return (
    <Card className={`relative ${nextSub?.isDue ? "border-warning/50 bg-warning/5" : "border-primary/30 bg-primary/5"}`}>
      {!readOnly && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground z-10"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      <CardContent className="p-3 pr-8">
        {/* Main row: Timer + Score + Controls */}
        <div className="flex items-center gap-3">
          {/* Timer icon */}
          <div className={`p-2.5 rounded-full shrink-0 ${nextSub?.isDue ? "bg-warning/20" : "bg-primary/10"}`}>
            <Timer className={`h-5 w-5 ${nextSub?.isDue ? "text-warning" : "text-primary"} ${timerState.isRunning ? 'animate-pulse' : ''}`} />
          </div>
          
          {/* Timer info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xl font-bold text-primary">
                {formatTime(displaySeconds, timerState.currentHalf, timerState.minutesPerHalf)}
              </span>
              {timerState.isRunning && (
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              )}
              {hasScore && (
                <span className="text-sm font-semibold text-muted-foreground ml-1">
                  {homeGoals} - {awayGoals}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{halfLabel}</span>
              {timerState.teamName && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground truncate">{timerState.teamName}</span>
                </>
              )}
            </div>
          </div>
          
          {/* Controls */}
          {!readOnly && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button 
                variant="outline" 
                size="icon" 
                className="h-10 w-10"
                onClick={toggleTimer}
              >
                {timerState.isRunning ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>
              {timerState.teamId && timerState.teamName && onOpenPitchBoard && (
                <Button 
                  variant="default" 
                  size="icon" 
                  className="h-10 w-10"
                  onClick={handleOpenPitchBoard}
                >
                  <ExternalLink className="h-5 w-5" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Next sub row */}
        {nextSub && (
          <div className={`mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 ${nextSub.isDue ? "bg-warning/15 border border-warning/30" : "bg-muted/50"}`}>
            {nextSub.isDue ? (
              <ArrowRightLeft className="h-4 w-4 text-warning shrink-0" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className={`text-xs font-medium flex-1 truncate ${nextSub.isDue ? "text-warning" : "text-muted-foreground"}`}>
              {formatSubCountdown()} — {nextSub.playerOut} → {nextSub.playerIn}
            </span>
            {totalUpcomingSubs > 1 && (
              <span className="text-[10px] text-muted-foreground shrink-0">+{totalUpcomingSubs - 1} more</span>
            )}
            {!readOnly && nextSub.isDue && onOpenPitchBoard && timerState.teamId && timerState.teamName && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-warning shrink-0"
                onClick={handleOpenPitchBoard}
              >
                <UserRoundCheck className="h-3.5 w-3.5" />
                Accept
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
