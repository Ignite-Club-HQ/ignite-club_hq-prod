import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { getSecondsSinceUpdate, getSecondsSinceUpdateUncapped } from "./timerUtils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Play, Pause } from "lucide-react";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { toast } from "@/hooks/use-toast";
import { useWakeLock } from "@/hooks/useWakeLock";

// Helper to play audio beep
const playBeepSound = (frequency: number, beepCount: number, beepDuration: number, beepGap: number) => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    for (let i = 0; i < beepCount; i++) {
      const delay = i * beepGap;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + delay);
      gainNode.gain.setValueAtTime(0.01, audioContext.currentTime + delay + beepDuration);
      
      oscillator.start(audioContext.currentTime + delay);
      oscillator.stop(audioContext.currentTime + delay + beepDuration);
    }
  } catch (error) {
    console.error('Failed to play beep sound:', error);
  }
};

export const playTimerBeep = (message?: string) => {
  // Send browser/push notification only (no in-app beep)
  if (message) {
    requestNotificationPermission().then(() => {
      showBrowserNotification("⚽ Game Alert", message);
    });
  }
};

// Sub alert - notification only (no in-app beep)
export const playSubAlertBeep = (message?: string) => {
  if (message) {
    requestNotificationPermission().then(() => {
      showBrowserNotification("🔄 Substitution Alert", message);
    });
  }
};

// Request notification permission when timer starts
export const requestTimerNotificationPermission = async () => {
  return requestNotificationPermission();
};

export interface GameTimerRef {
  getElapsedSeconds: () => number;
  getCurrentHalf: () => 1 | 2;
  getMinutesPerHalf: () => number;
  isRunning: () => boolean;
  isGameFinished: () => boolean;
  toggleTimer: () => boolean;
  resetTimer: () => void;
}

interface GameTimerProps {
  compact?: boolean;
  compactLarge?: boolean; // Larger compact mode when no score is showing
  large?: boolean; // Larger touch targets for landscape setup tab
  teamId?: string;
  teamName?: string;
  onTimeUpdate?: (elapsedSeconds: number, currentHalf: 1 | 2) => void;
  onHalfChange?: (newHalf: 1 | 2) => void;
  readOnly?: boolean;
  hideExtras?: boolean;
  hidePlayPause?: boolean;
  // External minutes per half control
  minutesPerHalf?: number;
  onMinutesPerHalfChange?: (minutes: number) => void;
  /** ISO timestamp of the linked event's kickoff. When set:
   *  - Manual start before kickoff is blocked.
   *  - Timer auto-starts at kickoff. */
  kickoffTime?: string | null;
}

// Legacy key used by widgets to find any active timer
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
// Team-specific keys for timer isolation
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  
  lastUpdateTime: number; // timestamp to calculate elapsed time while away
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean; // Track if game has reached full time
  gameFinishedAt?: number; // Timestamp when game finished (for auto-reset)
  manualReset?: boolean; // Set when coach manually reset; suppresses auto fast-forward
}

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

const saveTimerState = (state: TimerState, teamId?: string) => {
  try {
    // Always save to the active timer key for widgets to find
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(state));
    
    // Also save to team-specific key for isolation between games
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      localStorage.setItem(teamKey, JSON.stringify(state));
    }
    // Dispatch custom event so GlobalSubMonitor can react in same-tab (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'timer' } }));
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};

const loadTimerState = (teamId?: string): TimerState | null => {
  try {
    // If teamId provided, load from team-specific key for isolation
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      const teamSaved = localStorage.getItem(teamKey);
      if (teamSaved) {
        const parsed = JSON.parse(teamSaved) as TimerState;
        console.info('[TimerAudit] loadTimerState (team key)', { teamId, key: teamKey, state: parsed });
        return parsed;
      }
      
      // Fallback: check legacy/active key and migrate if it matches this team
      const active = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (active) {
        const activeState = JSON.parse(active) as TimerState;
        if (activeState.teamId === teamId) {
          // Save to team-specific key for future isolation
          localStorage.setItem(teamKey, active);
          console.info('[TimerAudit] loadTimerState (migrated active->team)', { teamId, state: activeState });
          return activeState;
        }
      }
      console.info('[TimerAudit] loadTimerState miss', { teamId });
      return null;
    }
    
    // No teamId - load from active key (used by widgets)
    const saved = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timer state:', e);
  }
  return null;
};

export const clearTimerState = (teamId?: string) => {
  try {
    // Clear team-specific key
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      localStorage.removeItem(teamKey);
      
      // Also clear active key if it matches this team
      const active = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (active) {
        try {
          const activeState = JSON.parse(active) as TimerState;
          if (activeState.teamId === teamId) {
            localStorage.removeItem(ACTIVE_TIMER_KEY);
          }
        } catch {}
      }
    } else {
      // No teamId - just clear active key
      localStorage.removeItem(ACTIVE_TIMER_KEY);
    }
  } catch (e) {
    console.error('Failed to clear timer state:', e);
  }
};

const GameTimer = forwardRef<GameTimerRef, GameTimerProps>(({ 
  compact = false,
  compactLarge = false,
  large = false,
  teamId,
  teamName,
  onTimeUpdate,
  onHalfChange,
  readOnly = false,
  hideExtras = false,
  hidePlayPause = false,
  minutesPerHalf: externalMinutesPerHalf,
  onMinutesPerHalfChange,
  kickoffTime,
}, ref) => {
  const internalKickoffMs = kickoffTime ? new Date(kickoffTime).getTime() : null;
  const kickoffMs = internalKickoffMs && !isNaN(internalKickoffMs) ? internalKickoffMs : null;
  const [internalMinutesPerHalf, setInternalMinutesPerHalf] = useState(45);
  const [currentHalf, setCurrentHalf] = useState<1 | 2>(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Keep the screen awake while the timer is running so iOS/Android don't
  // sleep mid-half and suspend the JS runtime.
  useWakeLock(isRunning && !isGameFinished);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Stable ref for onHalfChange to avoid restarting the interval every time
  // the callback identity changes (e.g. when `players` updates minutesPlayed).
  const onHalfChangeRef = useRef(onHalfChange);
  onHalfChangeRef.current = onHalfChange;

  // Stable ref for onTimeUpdate to prevent the notification effect from
  // re-firing when the callback identity changes (e.g. gameInProgress flip).
  // Re-firing can cause duplicate delta calculations, doubling player minutes.
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  // Use external minutesPerHalf if provided, otherwise use internal
  const minutesPerHalf = externalMinutesPerHalf !== undefined ? externalMinutesPerHalf : internalMinutesPerHalf;
  const setMinutesPerHalf = (mins: number) => {
    if (onMinutesPerHalfChange) {
      onMinutesPerHalfChange(mins);
    } else {
      setInternalMinutesPerHalf(mins);
    }
  };

  const halfDurationSeconds = minutesPerHalf * 60;

  // Cap elapsed time ONLY when paused. Capping while running/in-progress is
  // unsafe: a transient parent re-render that briefly drops
  // `externalMinutesPerHalf` to a smaller fallback (e.g. `|| 10` during a
  // React Query refetch) would otherwise instantly truncate a live clock
  // mid-half (the "stopped at 3:31, reverted to 10 min" bug).
  useEffect(() => {
    if (!hasInitialized) return;
    if (isRunning) return;
    if (elapsedSeconds > 0 || currentHalf === 2 || isGameFinished) return;
    if (elapsedSeconds > halfDurationSeconds) {
      console.info('[TimerAudit] cap-elapsed-to-half', {
        teamId, halfDurationSeconds, elapsedSeconds, minutesPerHalf,
      });
      setElapsedSeconds(halfDurationSeconds);
    }
  }, [halfDurationSeconds, hasInitialized, isRunning, elapsedSeconds, currentHalf, isGameFinished, teamId, minutesPerHalf]);

  // Trace every prop-driven minutesPerHalf change so we can correlate
  // mid-game reverts (e.g. "reverted to 10 min halves") with the upstream
  // refetch that caused them.
  const prevExternalMphRef = useRef<number | undefined>(externalMinutesPerHalf);
  useEffect(() => {
    if (prevExternalMphRef.current !== externalMinutesPerHalf) {
      console.info('[TimerAudit] externalMinutesPerHalf changed', {
        teamId,
        from: prevExternalMphRef.current,
        to: externalMinutesPerHalf,
        liveState: { isRunning, currentHalf, elapsedSeconds, isGameFinished },
        ts: new Date().toISOString(),
      });
      prevExternalMphRef.current = externalMinutesPerHalf;
    }
  }, [externalMinutesPerHalf, teamId, isRunning, currentHalf, elapsedSeconds, isGameFinished]);

  // Load state from localStorage on mount. CRITICAL: only run once per
  // teamId — previously this depended on `externalMinutesPerHalf` too, which
  // re-ran the entire restore (including resume drift) every time the parent
  // prop flickered, intermittently snapping the half/elapsed back to a stale
  // localStorage write and pausing the live timer.
  useEffect(() => {
    const saved = loadTimerState(teamId);
    // Only restore state if it belongs to THIS team (prevents timer bleeding between games)
    if (saved && saved.teamId === teamId) {
      // Only use saved minutesPerHalf if no external value is provided
      if (externalMinutesPerHalf === undefined) {
        setInternalMinutesPerHalf(saved.minutesPerHalf);
      }
      setIsGameFinished(saved.isGameFinished || false);

      // Use the correct half duration (external prop takes priority)
      const halfDuration = (externalMinutesPerHalf ?? saved.minutesPerHalf) * 60;

      // Check if game was finished
      if (saved.isGameFinished) {
        setCurrentHalf(saved.currentHalf);
        setElapsedSeconds(saved.elapsedSeconds);
        setIsRunning(false);
      } else if (saved.isRunning && saved.lastUpdateTime) {
        const secondsPassed = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
        // Carry drift through end-of-half so a long phone lock (e.g. whole
        // game spent backgrounded) still advances correctly instead of
        // freezing at the half boundary.
        let half: 1 | 2 = saved.currentHalf;
        let elapsed = (saved.elapsedSeconds || 0) + secondsPassed;
        let running = true;
        let finished = false;
        if (half === 1 && elapsed >= halfDuration) {
          half = 2;
          elapsed = elapsed - halfDuration;
          // Half boundary itself: coach must press play for 2nd half
          running = false;
          onHalfChangeRef.current?.(2);
        }
        if (half === 2 && elapsed >= halfDuration) {
          elapsed = halfDuration;
          running = false;
          finished = true;
        }
        setCurrentHalf(half);
        setElapsedSeconds(elapsed);
        setIsRunning(running);
        if (finished) setIsGameFinished(true);
      } else {
        setCurrentHalf(saved.currentHalf);
        setElapsedSeconds(saved.elapsedSeconds);
        setIsRunning(saved.isRunning);
      }
    }
    setHasInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // Save state to localStorage whenever it changes (only after initialization)
  useEffect(() => {
    if (!hasInitialized) return;
    
    saveTimerState({
      minutesPerHalf,
      currentHalf,
      elapsedSeconds,
      isRunning,
      lastUpdateTime: Date.now(),
      teamId,
      teamName,
      isGameFinished,
    }, teamId);
  }, [minutesPerHalf, currentHalf, elapsedSeconds, isRunning, hasInitialized, teamId, teamName, isGameFinished]);

  const toggleTimer = useCallback(() => {
    // Cannot resume if game is finished
    if (isGameFinished) return false;

    // If linked to an event, block manual start only after the post-kickoff window closes.
    if (!isRunning && kickoffMs && elapsedSeconds === 0 && currentHalf === 1) {
      const now = Date.now();
      const latest = kickoffMs + 2 * 60 * 60 * 1000;
      if (now > latest) {
        toast({
          title: "Kick-off window closed",
          description: "This event ended more than 2 hours ago.",
        });
        return false;
      }
    }

    let nextIsRunning = false;
    setIsRunning(prev => {
      nextIsRunning = !prev;
      return nextIsRunning;
    });

    return nextIsRunning;
  }, [isGameFinished, isRunning, kickoffMs, elapsedSeconds, currentHalf]);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setCurrentHalf(1);
    setElapsedSeconds(0);
    setIsGameFinished(false);
    clearTimerState(teamId);
    // Mark a manual reset so the kickoff-derived auto-resume logic doesn't
    // immediately fast-forward the clock back to "now - kickoff".
    if (kickoffMs && Date.now() >= kickoffMs) {
      try {
        saveTimerState({
          minutesPerHalf,
          currentHalf: 1,
          elapsedSeconds: 0,
          isRunning: false,
          lastUpdateTime: Date.now(),
          teamId,
          teamName,
          isGameFinished: false,
          manualReset: true,
        }, teamId);
      } catch {}
    }
  }, [teamId, kickoffMs, minutesPerHalf, teamName]);

  // Expose state via ref
  useImperativeHandle(ref, () => ({
    getElapsedSeconds: () => elapsedSeconds,
    getCurrentHalf: () => currentHalf,
    getMinutesPerHalf: () => minutesPerHalf,
    isRunning: () => isRunning,
    isGameFinished: () => isGameFinished,
    toggleTimer,
    resetTimer,
  }), [elapsedSeconds, currentHalf, minutesPerHalf, isRunning, isGameFinished, toggleTimer, resetTimer]);

  // Auto-start on kickoff has been removed — coach must press Play to start the timer.


  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const getDisplayTime = useCallback((cumulative = false) => {
    if (currentHalf === 1 || !cumulative) {
      return formatTime(elapsedSeconds);
    } else {
      return formatTime(halfDurationSeconds + elapsedSeconds);
    }
  }, [currentHalf, elapsedSeconds, halfDurationSeconds, formatTime]);

  // Request notification permission when timer starts
  useEffect(() => {
    if (isRunning) {
      requestTimerNotificationPermission();
    }
  }, [isRunning]);

  // Wall-clock anchor for the running tick. Set when the timer transitions
  // to running and re-anchored on every tick. Using Date.now() deltas (rather
  // than `prev + 1`) ensures the clock catches up when iOS/Android WebViews
  // throttle or skip setInterval callbacks while backgrounded or in low-power
  // mode — which is what caused U12 boys at Riverside to show 7:00 when 11:00
  // of real time had elapsed.
  const tickAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      tickAnchorRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const anchor = tickAnchorRef.current ?? now;
        const deltaSec = Math.floor((now - anchor) / 1000);
        // If the interval fired early (sub-second since last credit), skip
        // this tick rather than over-crediting a full second. The anchor is
        // left untouched so the next fire picks up the full elapsed delta.
        if (deltaSec < 1) return;
        // Advance anchor by exactly the seconds we credited, preserving the
        // sub-second remainder so we don't drift over a full half.
        tickAnchorRef.current = anchor + deltaSec * 1000;
        setElapsedSeconds(prev => {
          const newValue = prev + deltaSec;
          // Check if half is complete
          if (newValue >= halfDurationSeconds) {
            if (currentHalf === 1) {
              // End of first half - pause and switch to second half
              setIsRunning(false);
              setCurrentHalf(2);
              onHalfChangeRef.current?.(2);
              playTimerBeep("Half Time! First half complete.");
              return 0;
            } else {
              // End of match - mark game as finished
              setIsRunning(false);
              setIsGameFinished(true);
              // Save gameFinishedAt timestamp for auto-reset
              const finishedState: TimerState = {
                minutesPerHalf,
                currentHalf: 2,
                elapsedSeconds: halfDurationSeconds,
                isRunning: false,
                lastUpdateTime: Date.now(),
                teamId,
                teamName,
                isGameFinished: true,
                gameFinishedAt: Date.now(),
              };
              saveTimerState(finishedState, teamId);
              playTimerBeep("Full Time! Match complete.");
              return halfDurationSeconds;
            }
          }
          return newValue;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, halfDurationSeconds, currentHalf]);

  // Reconcile timer when app resumes from background (no 30s cap)
  // CRITICAL: register listeners ONCE per teamId. Previously the dep array
  // included elapsedSeconds/currentHalf/isRunning, causing this effect to
  // tear down + re-register every tick. On Android Capacitor the async
  // `import('@capacitor/app')` couldn't keep up, leaking listeners and
  // racing with cleanup (so reconcile sometimes never ran on resume).
  const reconcileRefs = useRef({
    isRunning,
    isGameFinished,
    currentHalf,
    elapsedSeconds,
    minutesPerHalf,
    halfDurationSeconds,
    teamId,
    teamName,
  });
  reconcileRefs.current = {
    isRunning,
    isGameFinished,
    currentHalf,
    elapsedSeconds,
    minutesPerHalf,
    halfDurationSeconds,
    teamId,
    teamName,
  };

  useEffect(() => {
    const reconcileAfterResume = () => {
      const r = reconcileRefs.current;
      if (r.isGameFinished) return;
      const saved = loadTimerState(r.teamId);
      if (!saved || !saved.isRunning || !saved.lastUpdateTime) return;

      const uncappedDrift = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
      if (uncappedDrift < 2) return;

      const halfDur = (r.minutesPerHalf || saved.minutesPerHalf) * 60;
      let half: 1 | 2 = saved.currentHalf;
      let elapsed = (saved.elapsedSeconds || 0) + uncappedDrift;
      let running = true;
      let finished = false;
      let crossedHalf = false;
      if (half === 1 && elapsed >= halfDur) {
        half = 2;
        elapsed = elapsed - halfDur;
        running = false;
        crossedHalf = true;
      }
      if (half === 2 && elapsed >= halfDur) {
        elapsed = halfDur;
        running = false;
        finished = true;
      }

      console.log(`[Timer] Resume reconciliation: +${uncappedDrift}s drift, half ${saved.currentHalf}->${half}, elapsed ${saved.elapsedSeconds}->${elapsed}`);
      // Re-anchor the wall-clock tick so the next setInterval fire doesn't
      // double-credit the drift we just added here.
      tickAnchorRef.current = Date.now();
      setCurrentHalf(half);
      setElapsedSeconds(elapsed);
      setIsRunning(running);
      if (finished) {
        setIsGameFinished(true);
        playTimerBeep("Full Time! Match complete.");
      } else if (crossedHalf) {
        onHalfChangeRef.current?.(2);
        playTimerBeep("Half Time! First half complete.");
      }
    };

    const flushOnHide = () => {
      const r = reconcileRefs.current;
      if (!r.isRunning || r.isGameFinished) return;
      try {
        saveTimerState({
          minutesPerHalf: r.minutesPerHalf,
          currentHalf: r.currentHalf,
          elapsedSeconds: r.elapsedSeconds,
          isRunning: true,
          lastUpdateTime: Date.now(),
          teamId: r.teamId,
          teamName: r.teamName,
          isGameFinished: false,
        }, r.teamId);
      } catch {}
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconcileAfterResume();
      else flushOnHide();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', reconcileAfterResume);
    window.addEventListener('focus', reconcileAfterResume);
    window.addEventListener('pagehide', flushOnHide);
    window.addEventListener('beforeunload', flushOnHide);
    document.addEventListener('freeze', flushOnHide as any);
    document.addEventListener('resume', reconcileAfterResume as any);

    // Capacitor app state — track listener + cancellation so cleanup can't race
    let appListener: any = null;
    let cancelled = false;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const listener = await CapApp.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
          if (isActive) reconcileAfterResume();
          else flushOnHide();
        });
        if (cancelled) {
          listener.remove();
        } else {
          appListener = listener;
        }
      } catch {}
    })();

    // Run reconciliation immediately on mount — handles the case where
    // the app resumed (visibilitychange/appStateChange already fired)
    // BEFORE this effect registered its listeners.
    reconcileAfterResume();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', reconcileAfterResume);
      window.removeEventListener('focus', reconcileAfterResume);
      window.removeEventListener('pagehide', flushOnHide);
      window.removeEventListener('beforeunload', flushOnHide);
      document.removeEventListener('freeze', flushOnHide as any);
      document.removeEventListener('resume', reconcileAfterResume as any);
      appListener?.remove?.();
    };
  }, [teamId]);

  // Notify parent of time updates — use stable ref to avoid re-firing
  // when the callback identity changes (which was doubling player minutes).
  useEffect(() => {
    onTimeUpdateRef.current?.(elapsedSeconds, currentHalf);
  }, [elapsedSeconds, currentHalf]);

  // toggleTimer moved above useImperativeHandle

  const handleHalfDurationChange = (value: string) => {
    const mins = parseInt(value);
    setMinutesPerHalf(mins);
    // Reset timer when duration changes
    resetTimer();
  };


  if (compact) {
    const isLarge = compactLarge;
    return (
      <div className={cn("flex items-center", isLarge ? "gap-2" : "gap-1")}>
        {!hideExtras && (
          <Select value={minutesPerHalf.toString()} onValueChange={handleHalfDurationChange} disabled={readOnly || isGameFinished || isRunning || elapsedSeconds > 0}>
            <SelectTrigger className={cn(isLarge ? "w-16 h-9 text-sm px-2" : "w-14 h-7 text-xs px-1.5")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[99999] bg-popover">
              <SelectItem value="5">5m</SelectItem>
              <SelectItem value="10">10m</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="20">20m</SelectItem>
              <SelectItem value="25">25m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="35">35m</SelectItem>
              <SelectItem value="40">40m</SelectItem>
              <SelectItem value="45">45m</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className={cn(
          "flex items-center rounded",
          isLarge ? "px-2.5 py-1" : "px-1.5 py-0.5",
          isLarge ? "text-sm" : "text-xs",
          isGameFinished ? "bg-primary/20" : "bg-muted"
        )}>
          <span className={cn("font-medium text-muted-foreground", isLarge && "text-sm")}>
            {isGameFinished ? "FT" : `H${currentHalf}`}
          </span>
          <span className={cn("font-mono font-bold ml-1", isLarge ? "text-lg" : "")}>
            {getDisplayTime(false)}
          </span>
        </div>
        {!readOnly && !hidePlayPause && (
          <Button
            variant="outline"
            size="icon"
            className={cn(isLarge ? "h-10 w-10" : "h-8 w-8")}
            onClick={toggleTimer}
            disabled={isGameFinished}
          >
            {isRunning ? <Pause className={cn(isLarge ? "h-4 w-4" : "h-3 w-3")} /> : <Play className={cn(isLarge ? "h-4 w-4" : "h-3 w-3")} />}
          </Button>
        )}

      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!hideExtras && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Minutes per Half</span>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {[5, 10, 15, 20, 25, 30, 35, 40, 45].map((v) => {
              const isDisabled = readOnly || isGameFinished || isRunning || elapsedSeconds > 0;
              return (
                <button
                  key={v}
                  onClick={() => !isDisabled && handleHalfDurationChange(v.toString())}
                  disabled={isDisabled}
                  className={cn(
                    "flex-1 py-2.5 text-sm font-medium transition-colors",
                    minutesPerHalf === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted",
                    isDisabled && minutesPerHalf !== v && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
      
      <div className={cn(
        "flex items-center gap-1.5 rounded-md",
        large ? "px-4 py-2.5" : "px-2 py-1",
        isGameFinished ? "bg-primary/20" : "bg-muted/60"
      )}>
        <span className={cn("font-medium text-muted-foreground", large ? "text-base" : "text-xs")}>
          {isGameFinished ? "FT" : (currentHalf === 1 ? "1H" : "2H")}
        </span>
        <span className={cn("font-mono font-bold tabular-nums", large ? "text-2xl" : "text-xl")}>{getDisplayTime(false)}</span>
      </div>
      
      {!readOnly && !hidePlayPause && (
        <Button
          variant="outline"
          size={large ? "default" : "icon"}
          className={large ? "h-12 w-12" : undefined}
          onClick={toggleTimer}
          disabled={isGameFinished}
        >
          {isRunning ? <Pause className={large ? "h-5 w-5" : "h-4 w-4"} /> : <Play className={large ? "h-5 w-5" : "h-4 w-4"} />}
        </Button>
      )}
      
      </div>
    </div>
  );
});

GameTimer.displayName = "GameTimer";

export default GameTimer;
