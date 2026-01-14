import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";

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
  // Play audio beep
  playBeepSound(880, 3, 0.2, 0.3);
  
  // Also send browser notification (works even when phone is asleep)
  if (message) {
    // Request permission first, then show notification
    requestNotificationPermission().then(() => {
      showBrowserNotification("⚽ Game Alert", message);
    });
  }
};

// Play sub alert beep - different sound
export const playSubAlertBeep = (message?: string) => {
  // Play audio beep
  playBeepSound(1200, 2, 0.15, 0.2);
  
  // Also send browser notification (works even when phone is asleep)
  if (message) {
    // Request permission first, then show notification
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
  toggleTimer: () => void;
  resetTimer: () => void;
}

interface GameTimerProps {
  compact?: boolean;
  teamId?: string;
  teamName?: string;
  onTimeUpdate?: (elapsedSeconds: number, currentHalf: 1 | 2) => void;
  onHalfChange?: (newHalf: 1 | 2) => void;
  readOnly?: boolean; // Allow play/pause and sound toggle, but disable reset and duration changes
  hideExtras?: boolean; // Hide volume and reset buttons (for collapsed views)
  hideSoundToggle?: boolean; // Hide sound toggle (when controlled externally)
  hidePlayPause?: boolean; // Hide play/pause button (when controlled externally)
  soundEnabled?: boolean; // External sound state
  onSoundToggle?: (enabled: boolean) => void; // External sound toggle callback
  // External minutes per half control
  minutesPerHalf?: number;
  onMinutesPerHalfChange?: (minutes: number) => void;
}

const TIMER_STORAGE_KEY = 'pitch-board-timer-state';

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number; // timestamp to calculate elapsed time while away
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean; // Track if game has reached full time
}

const saveTimerState = (state: TimerState) => {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};

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

export const clearTimerState = () => {
  try {
    localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear timer state:', e);
  }
};

const GameTimer = forwardRef<GameTimerRef, GameTimerProps>(({ 
  compact = false,
  teamId,
  teamName,
  onTimeUpdate,
  onHalfChange,
  readOnly = false,
  hideExtras = false,
  hideSoundToggle = false,
  hidePlayPause = false,
  soundEnabled: externalSoundEnabled,
  onSoundToggle,
  minutesPerHalf: externalMinutesPerHalf,
  onMinutesPerHalfChange,
}, ref) => {
  const [internalMinutesPerHalf, setInternalMinutesPerHalf] = useState(45);
  const [currentHalf, setCurrentHalf] = useState<1 | 2>(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [internalSoundEnabled, setInternalSoundEnabled] = useState(true);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isGameFinished, setIsGameFinished] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use external sound state if provided, otherwise use internal
  const soundEnabled = externalSoundEnabled !== undefined ? externalSoundEnabled : internalSoundEnabled;
  const handleSoundToggle = () => {
    if (onSoundToggle) {
      onSoundToggle(!soundEnabled);
    } else {
      setInternalSoundEnabled(!soundEnabled);
    }
  };

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

  // Load state from localStorage on mount
  useEffect(() => {
    const saved = loadTimerState();
    if (saved) {
      // Only use saved minutesPerHalf if no external value is provided
      if (externalMinutesPerHalf === undefined) {
        setInternalMinutesPerHalf(saved.minutesPerHalf);
      }
      setCurrentHalf(saved.currentHalf);
      setInternalSoundEnabled(saved.soundEnabled);
      setIsGameFinished(saved.isGameFinished || false);
      
      // Use the correct half duration (external prop takes priority)
      const halfDuration = (externalMinutesPerHalf ?? saved.minutesPerHalf) * 60;
      
      // Check if game was finished
      if (saved.isGameFinished) {
        setElapsedSeconds(saved.elapsedSeconds);
        setIsRunning(false);
      } else if (saved.isRunning && saved.lastUpdateTime) {
        // Calculate time passed while away
        const secondsPassed = Math.floor((Date.now() - saved.lastUpdateTime) / 1000);
        const newElapsed = saved.elapsedSeconds + secondsPassed;
        // Cap at half duration
        setElapsedSeconds(Math.min(newElapsed, halfDuration));
        setIsRunning(true);
      } else {
        setElapsedSeconds(saved.elapsedSeconds);
        setIsRunning(saved.isRunning);
      }
    }
    setHasInitialized(true);
  }, [externalMinutesPerHalf]);

  // Save state to localStorage whenever it changes (only after initialization)
  useEffect(() => {
    if (!hasInitialized) return;
    
    saveTimerState({
      minutesPerHalf,
      currentHalf,
      elapsedSeconds,
      isRunning,
      soundEnabled,
      lastUpdateTime: Date.now(),
      teamId,
      teamName,
      isGameFinished,
    });
  }, [minutesPerHalf, currentHalf, elapsedSeconds, isRunning, soundEnabled, hasInitialized, teamId, teamName, isGameFinished]);

  const toggleTimer = useCallback(() => {
    // Cannot resume if game is finished
    if (isGameFinished) return;
    setIsRunning(prev => !prev);
  }, [isGameFinished]);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setCurrentHalf(1);
    setElapsedSeconds(0);
    setIsGameFinished(false);
    clearTimerState();
  }, []);

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

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const getDisplayTime = useCallback(() => {
    if (currentHalf === 1) {
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

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => {
          const newValue = prev + 1;
          // Check if half is complete
          if (newValue >= halfDurationSeconds) {
            if (currentHalf === 1) {
              // End of first half - pause and switch to second half
              setIsRunning(false);
              setCurrentHalf(2);
              onHalfChange?.(2);
              if (soundEnabled) playTimerBeep("Half Time! First half complete.");
              return 0;
            } else {
              // End of match - mark game as finished
              setIsRunning(false);
              setIsGameFinished(true);
              if (soundEnabled) playTimerBeep("Full Time! Match complete.");
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
  }, [isRunning, halfDurationSeconds, currentHalf, soundEnabled, onHalfChange]);

  // Notify parent of time updates
  useEffect(() => {
    onTimeUpdate?.(elapsedSeconds, currentHalf);
  }, [elapsedSeconds, currentHalf, onTimeUpdate]);

  // toggleTimer moved above useImperativeHandle

  const handleHalfDurationChange = (value: string) => {
    const mins = parseInt(value);
    setMinutesPerHalf(mins);
    // Reset timer when duration changes
    resetTimer();
  };


  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {!hideExtras && (
          <Select value={minutesPerHalf.toString()} onValueChange={handleHalfDurationChange} disabled={readOnly || isGameFinished}>
            <SelectTrigger className="w-14 h-7 text-xs px-1.5">
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
          "flex items-center px-1.5 py-0.5 rounded text-xs",
          isGameFinished ? "bg-primary/20" : "bg-muted"
        )}>
          <span className="font-medium text-muted-foreground">
            {isGameFinished ? "FT" : `H${currentHalf}`}
          </span>
          <span className="font-mono font-bold ml-1">{getDisplayTime()}</span>
        </div>
        {!readOnly && !hidePlayPause && (
          <Button 
            variant="outline" 
            size="icon" 
            className="h-8 w-8" 
            onClick={toggleTimer}
            disabled={isGameFinished}
          >
            {isRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
        )}
        {!hideExtras && !readOnly && !hideSoundToggle && (
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleSoundToggle}>
            {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!hideExtras && (
        <Select value={minutesPerHalf.toString()} onValueChange={handleHalfDurationChange} disabled={readOnly || isGameFinished}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[99999] bg-popover">
            <SelectItem value="5">5 min</SelectItem>
            <SelectItem value="10">10 min</SelectItem>
            <SelectItem value="15">15 min</SelectItem>
            <SelectItem value="20">20 min</SelectItem>
            <SelectItem value="25">25 min</SelectItem>
            <SelectItem value="30">30 min</SelectItem>
            <SelectItem value="35">35 min</SelectItem>
            <SelectItem value="40">40 min</SelectItem>
            <SelectItem value="45">45 min</SelectItem>
          </SelectContent>
        </Select>
      )}
      
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md",
        isGameFinished ? "bg-primary/20" : "bg-muted"
      )}>
        <span className="text-sm font-medium text-muted-foreground">
          {isGameFinished ? "Full Time" : (currentHalf === 1 ? "1st Half" : "2nd Half")}
        </span>
        <span className="font-mono text-lg font-bold">{getDisplayTime()}</span>
      </div>
      
      {!readOnly && !hidePlayPause && (
        <Button 
          variant="outline" 
          size="icon" 
          onClick={toggleTimer}
          disabled={isGameFinished}
        >
          {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      )}
      {!hideExtras && !hideSoundToggle && (
        <Button variant="outline" size="icon" onClick={handleSoundToggle}>
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      )}
      
    </div>
  );
});

GameTimer.displayName = "GameTimer";

export default GameTimer;
