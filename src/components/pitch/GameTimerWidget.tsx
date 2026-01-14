import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Pause, Timer, ExternalLink, X } from "lucide-react";
import { useIsLandscape } from "@/hooks/useIsLandscape";

const TIMER_STORAGE_KEY = 'pitch-board-timer-state';

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
}

const loadTimerState = (): TimerState | null => {
  try {
    const saved = localStorage.getItem(TIMER_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timer state:', e);
  }
  return null;
};

const saveTimerState = (state: TimerState) => {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};

interface GameTimerWidgetProps {
  onOpenPitchBoard?: (teamId: string, teamName: string) => void;
}

export default function GameTimerWidget({ onOpenPitchBoard }: GameTimerWidgetProps) {
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const { isLandscape } = useIsLandscape();

  // Load and sync timer state
  useEffect(() => {
    const checkTimerState = () => {
      const saved = loadTimerState();
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
    localStorage.removeItem(TIMER_STORAGE_KEY);
    
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
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
        >
          <X className="h-3 w-3" />
        </Button>
        <CardContent className="p-2 pr-6">
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
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/5 relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={handleDismiss}
      >
        <X className="h-4 w-4" />
      </Button>
      <CardContent className="p-4 pr-8">
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
        </div>
      </CardContent>
    </Card>
  );
}
