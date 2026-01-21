import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Pause, Timer, ExternalLink, X } from "lucide-react";
import { useIsLandscape } from "@/hooks/useIsLandscape";

// Active timer key - mirrors the one in GameTimer.tsx
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';

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

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

/**
 * Load the active timer state for display in widget.
 * First checks the ACTIVE_TIMER_KEY, then validates against team-specific storage
 * to ensure we're showing the correct timer even after navigation.
 */
const loadActiveTimerState = (): TimerState | null => {
  try {
    // First, check the active timer key
    const activeRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (!activeRaw) return null;
    
    const activeState = JSON.parse(activeRaw) as TimerState;
    
    // If the active state has a teamId, verify it exists in team-specific storage
    // This ensures we don't show stale data from a cleared timer
    if (activeState.teamId) {
      const teamKey = getTeamTimerStorageKey(activeState.teamId);
      const teamRaw = localStorage.getItem(teamKey);
      
      if (teamRaw) {
        // Use the team-specific state as it's more reliable
        return JSON.parse(teamRaw) as TimerState;
      }
      
      // Team-specific storage doesn't exist but active key does - 
      // this could happen during migration, so trust the active key
      return activeState;
    }
    
    return activeState;
  } catch (e) {
    console.error('Failed to load active timer state:', e);
  }
  return null;
};

/**
 * Save timer state to both active key and team-specific key
 */
const saveTimerState = (state: TimerState) => {
  try {
    // Save to active key for widgets
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(state));
    
    // Also save to team-specific key for isolation
    if (state.teamId) {
      const teamKey = getTeamTimerStorageKey(state.teamId);
      localStorage.setItem(teamKey, JSON.stringify(state));
    }
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};

interface GameTimerWidgetProps {
  onOpenPitchBoard?: (teamId: string, teamName: string) => void;
  /** If true, only show timer info - no controls to edit */
  readOnly?: boolean;
}

export default function GameTimerWidget({ onOpenPitchBoard, readOnly = false }: GameTimerWidgetProps) {
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const { isLandscape } = useIsLandscape();

  // Load and sync timer state
  useEffect(() => {
    const checkTimerState = () => {
      const saved = loadActiveTimerState();
      if (saved) {
        let currentElapsed = saved.elapsedSeconds;
        
        // Calculate time elapsed since last update if running
        if (saved.isRunning && saved.lastUpdateTime) {
          const secondsPassed = Math.floor((Date.now() - saved.lastUpdateTime) / 1000);
          currentElapsed = Math.min(saved.elapsedSeconds + secondsPassed, saved.minutesPerHalf * 60);
        }
        
        setTimerState(saved);
        setDisplaySeconds(currentElapsed);
      } else {
        setTimerState(null);
      }
    };

    checkTimerState();
    const interval = setInterval(checkTimerState, 1000);
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
    
    // Clear the active timer key
    localStorage.removeItem(ACTIVE_TIMER_KEY);
    
    // Also clear the team-specific key if we have a teamId
    if (timerState?.teamId) {
      const teamKey = getTeamTimerStorageKey(timerState.teamId);
      localStorage.removeItem(teamKey);
    }
    
    // Clear auto-sub plan from pitch state before removing it
    const pitchStateRaw = localStorage.getItem('pitch-board-state');
    if (pitchStateRaw) {
      try {
        const pitchState = JSON.parse(pitchStateRaw);
        pitchState.autoSubPlan = [];
        pitchState.autoSubActive = false;
        pitchState.autoSubPaused = false;
        localStorage.setItem('pitch-board-state', JSON.stringify(pitchState));
      } catch (e) {
        console.error('Failed to clear auto-sub plan:', e);
      }
    }
    localStorage.removeItem('pitch-board-state');
    setTimerState(null);
  };

  // Don't show if no timer state, timer hasn't started, or game has concluded
  const isGameConcluded = timerState?.currentHalf === 2 && displaySeconds >= (timerState?.minutesPerHalf || 0) * 60;
  if (!timerState || (timerState.elapsedSeconds === 0 && !timerState.isRunning && timerState.currentHalf === 1) || isGameConcluded) {
    return null;
  }

  // Compact layout for landscape mode - positioned top-left
  if (isLandscape) {
    return (
      <Card className="border-primary/30 bg-primary/5 relative w-fit">
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-0 right-0 h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        <CardContent className={`p-2 ${!readOnly ? 'pr-6' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-primary/10 shrink-0">
              <Timer className={`h-4 w-4 text-primary ${timerState.isRunning ? 'animate-pulse' : ''}`} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {timerState.currentHalf === 1 ? "1H" : "2H"}
              </span>
              <span className="font-mono text-sm font-bold text-primary">
                {formatTime(displaySeconds, timerState.currentHalf, timerState.minutesPerHalf)}
              </span>
              {timerState.isRunning && (
                <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              )}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1 shrink-0">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-7 w-7"
                  onClick={toggleTimer}
                >
                  {timerState.isRunning ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
                {timerState.teamId && timerState.teamName && onOpenPitchBoard && (
                  <Button 
                    variant="default" 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={handleOpenPitchBoard}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/5 relative">
      {!readOnly && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      <CardContent className={`p-4 ${!readOnly ? 'pr-8' : ''}`}>
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-primary/10 shrink-0">
            <Timer className={`h-6 w-6 text-primary ${timerState.isRunning ? 'animate-pulse' : ''}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold flex items-center gap-2">
              {timerState.teamName || "Game In Progress"}
              {timerState.isRunning && (
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              )}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {timerState.currentHalf === 1 ? "1st Half" : "2nd Half"}
              </span>
              <span className="font-mono text-lg font-bold text-primary">
                {formatTime(displaySeconds, timerState.currentHalf, timerState.minutesPerHalf)}
              </span>
            </div>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2 shrink-0">
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
      </CardContent>
    </Card>
  );
}
