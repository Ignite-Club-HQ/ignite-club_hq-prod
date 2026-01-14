import { 
  PitchBoardState, 
  TimerState, 
  PITCH_STATE_KEY, 
  TIMER_STORAGE_KEY,
  Player,
  SubstitutionEvent,
  TeamSize
} from "./types";
import { PitchPosition } from "./PositionBadge";

export const loadTimerStateForMinutes = (): TimerState | null => {
  try {
    const saved = localStorage.getItem(TIMER_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timer state for minutes:', e);
  }
  return null;
};

// Check if sound is enabled in timer settings
export const isSoundEnabled = (): boolean => {
  try {
    const timerState = loadTimerStateForMinutes();
    return timerState?.soundEnabled ?? true; // Default to true if not set
  } catch {
    return true;
  }
};

export const savePitchState = (teamId: string, state: Omit<PitchBoardState, 'teamId' | 'lastUpdateTime'>) => {
  try {
    const timerState = loadTimerStateForMinutes();
    let currentTimerSeconds = 0;
    if (timerState) {
      if (timerState.isRunning && timerState.lastUpdateTime) {
        const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
        currentTimerSeconds = Math.min(timerState.elapsedSeconds + secondsPassed, timerState.minutesPerHalf * 60);
      } else {
        currentTimerSeconds = timerState.elapsedSeconds;
      }
      if (timerState.currentHalf === 2) {
        currentTimerSeconds += timerState.minutesPerHalf * 60;
      }
    }
    
    const fullState: PitchBoardState = {
      teamId,
      ...state,
      lastUpdateTime: Date.now(),
      lastTimerSeconds: currentTimerSeconds,
    };
    console.log("[PitchState] SAVING state:", { teamId, playerCount: state.players.length, lastTimerSeconds: currentTimerSeconds });
    localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(fullState));
  } catch (e) {
    console.error("Failed to save pitch state:", e);
  }
};

export const loadPitchState = (teamId: string): PitchBoardState | null => {
  try {
    const saved = localStorage.getItem(PITCH_STATE_KEY);
    if (!saved) {
      console.log("[PitchState] LOAD - no saved state found");
      return null;
    }
    const state = JSON.parse(saved) as PitchBoardState;
    if (state.teamId !== teamId) {
      console.log("[PitchState] LOAD - saved state is for different team");
      return null;
    }
    
    const timerState = loadTimerStateForMinutes();
    if (timerState && state.lastTimerSeconds !== undefined) {
      let currentTimerSeconds = 0;
      if (timerState.isRunning && timerState.lastUpdateTime) {
        const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
        currentTimerSeconds = Math.min(timerState.elapsedSeconds + secondsPassed, timerState.minutesPerHalf * 60);
      } else {
        currentTimerSeconds = timerState.elapsedSeconds;
      }
      if (timerState.currentHalf === 2) {
        currentTimerSeconds += timerState.minutesPerHalf * 60;
      }
      
      const gameSecondsElapsed = currentTimerSeconds - state.lastTimerSeconds;
      console.log("[PitchState] Minutes catchup:", { lastTimerSeconds: state.lastTimerSeconds, currentTimerSeconds, gameSecondsElapsed });
      
      if (gameSecondsElapsed > 0) {
        state.players = state.players.map(p => {
          if (p.position !== null) {
            return { ...p, minutesPlayed: (p.minutesPlayed || 0) + gameSecondsElapsed };
          }
          return p;
        });
        console.log("[PitchState] Added", gameSecondsElapsed, "seconds to on-pitch players");
      }
    }
    
    console.log("[PitchState] LOADED state:", { teamId: state.teamId, playerCount: state.players.length });
    return state;
  } catch (e) {
    console.error("Failed to load pitch state:", e);
    return null;
  }
};

export const clearPitchState = () => {
  try {
    localStorage.removeItem(PITCH_STATE_KEY);
  } catch (e) {
    console.error("Failed to clear pitch state:", e);
  }
};

// Recalculate substitution plan when a sub is skipped
export const recalculateRemainingPlan = (
  currentPlayers: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  currentElapsedSeconds: number,
  currentHalf: 1 | 2,
  skippedSub: SubstitutionEvent
): SubstitutionEvent[] => {
  const plan: SubstitutionEvent[] = [];
  
  const playersOnPitch = currentPlayers.filter(p => p.position !== null);
  const benchPlayers = currentPlayers.filter(p => p.position === null && !p.isInjured); // Exclude injured players
  
  if (benchPlayers.length === 0) return [];
  
  const gkOnPitch = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  const gkOnBench = benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1);
  
  const outfieldPlayers = currentPlayers.filter(p => {
    if (p.currentPitchPosition === "GK") return false;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    if (p.isInjured && p.position === null) return false; // Exclude injured bench players
    return true;
  });
  
  const outfieldOnBench = benchPlayers.filter(p => {
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });
  
  if (outfieldOnBench.length === 0) {
    if (gkOnBench && gkOnPitch && currentHalf === 1) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkOnBench,
        executed: false,
      });
    }
    return plan;
  }
  
  const fieldPositions = teamSize - 1;
  const remainingInCurrentHalf = halfDurationSeconds - currentElapsedSeconds;
  const remainingInSecondHalf = currentHalf === 1 ? halfDurationSeconds : 0;
  const totalRemainingSeconds = remainingInCurrentHalf + remainingInSecondHalf;
  
  const currentOnPitch = new Map<string, PitchPosition>();
  playersOnPitch.filter(p => p.currentPitchPosition !== "GK").forEach(p => {
    currentOnPitch.set(p.id, p.currentPitchPosition as PitchPosition);
  });
  
  const getPlayer = (id: string) => outfieldPlayers.find(p => p.id === id);
  
  const minSubInterval = 120;
  const subsNeeded = Math.min(
    outfieldOnBench.length,
    Math.floor(totalRemainingSeconds / minSubInterval)
  );
  
  if (subsNeeded <= 0) return [];
  
  const generateRemainingSubTimes = (): { time: number; half: 1 | 2 }[] => {
    const times: { time: number; half: 1 | 2 }[] = [];
    const interval = totalRemainingSeconds / (subsNeeded + 1);
    
    let accumulatedTime = 0;
    for (let i = 1; i <= subsNeeded; i++) {
      accumulatedTime += interval;
      
      if (currentHalf === 1) {
        if (accumulatedTime + currentElapsedSeconds <= halfDurationSeconds) {
          times.push({ 
            time: Math.floor(currentElapsedSeconds + accumulatedTime), 
            half: 1 
          });
        } else {
          const timeInSecondHalf = accumulatedTime - remainingInCurrentHalf;
          times.push({ 
            time: Math.floor(timeInSecondHalf), 
            half: 2 
          });
        }
      } else {
        times.push({ 
          time: Math.floor(currentElapsedSeconds + accumulatedTime), 
          half: 2 
        });
      }
    }
    return times;
  };
  
  const subTimes = generateRemainingSubTimes();
  
  for (const { time, half } of subTimes) {
    const onPitchSorted = Array.from(currentOnPitch.keys())
      .map(id => ({ id, time: getPlayer(id)?.minutesPlayed || 0, player: getPlayer(id)! }))
      .filter(p => p.player)
      .sort((a, b) => b.time - a.time);
    
    const benchSorted = outfieldPlayers
      .filter(p => !currentOnPitch.has(p.id))
      .map(p => ({ id: p.id, time: p.minutesPlayed || 0, player: p }))
      .sort((a, b) => a.time - b.time);
    
    if (onPitchSorted.length === 0 || benchSorted.length === 0) continue;
    
    let playerOut: Player | undefined;
    let playerIn: Player | undefined;
    let positionSwap: SubstitutionEvent["positionSwap"] | undefined;
    
    for (const benchEntry of benchSorted) {
      for (const pitchEntry of onPitchSorted) {
        const pitchPos = currentOnPitch.get(pitchEntry.id);
        
        if (!benchEntry.player.assignedPositions?.length || 
            benchEntry.player.assignedPositions.includes(pitchPos!)) {
          playerOut = pitchEntry.player;
          playerIn = benchEntry.player;
          break;
        }
      }
      if (playerOut && playerIn) break;
    }
    
    if (!playerOut || !playerIn) {
      playerOut = onPitchSorted[0].player;
      playerIn = benchSorted[0].player;
    }
    
    const sub: SubstitutionEvent = {
      time,
      half,
      playerOut,
      playerIn,
      positionSwap,
      executed: false,
    };
    
    plan.push(sub);
    
    const outPos = currentOnPitch.get(playerOut.id);
    currentOnPitch.delete(playerOut.id);
    if (outPos) {
      currentOnPitch.set(playerIn.id, outPos);
    }
  }
  
  return plan;
};
