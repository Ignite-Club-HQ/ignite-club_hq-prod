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

// Legacy key used by widgets to find any active timer
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
// Team-specific keys for timer isolation
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

export const loadTimerStateForMinutes = (teamId?: string): TimerState | null => {
  try {
    // If teamId provided, load from team-specific key for isolation
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      const teamSaved = localStorage.getItem(teamKey);
      if (teamSaved) {
        return JSON.parse(teamSaved);
      }
      
      // Fallback: check active key and use if it matches this team
      const active = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (active) {
        const activeState = JSON.parse(active) as TimerState;
        if (activeState.teamId === teamId) {
          return activeState;
        }
      }
      // No timer state for this team
      return null;
    }
    
    // No teamId - load from active key
    const saved = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timer state for minutes:', e);
  }
  return null;
};

// Check if sound is enabled in timer settings
export const isSoundEnabled = (teamId?: string): boolean => {
  try {
    const timerState = loadTimerStateForMinutes(teamId);
    return timerState?.soundEnabled ?? true; // Default to true if not set
  } catch {
    return true;
  }
};

export const savePitchState = (teamId: string, state: Omit<PitchBoardState, 'teamId' | 'lastUpdateTime'>) => {
  try {
    const timerState = loadTimerStateForMinutes(teamId);
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
    
    const timerState = loadTimerStateForMinutes(teamId);
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
  skippedSub: SubstitutionEvent,
  rotateGkAtHalftime: boolean = true
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
    if (rotateGkAtHalftime && gkOnPitch && currentHalf === 1) {
      const gkReplacement = gkOnBench || null;
      if (gkReplacement) {
        plan.push({
          time: 0,
          half: 2,
          playerOut: gkOnPitch,
          playerIn: gkReplacement,
          executed: false,
        });
      }
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
  
  // Scale subs at once based on bench size for better throughput
  const subsAtOnce = Math.min(outfieldOnBench.length >= 4 ? 3 : 2, outfieldOnBench.length);
  
  const subsNeeded = Math.min(
    outfieldOnBench.length,
    Math.floor(totalRemainingSeconds / minSubInterval)
  );
  
  if (subsNeeded <= 0) return [];
  
  // Calculate number of sub windows - fewer windows = fewer interruptions
  const numWindows = Math.max(1, Math.ceil(subsNeeded / subsAtOnce));
  
  const generateRemainingSubTimes = (): { time: number; half: 1 | 2 }[] => {
    const times: { time: number; half: 1 | 2 }[] = [];
    const interval = totalRemainingSeconds / (numWindows + 1);
    
    let accumulatedTime = 0;
    for (let i = 1; i <= numWindows; i++) {
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
  
  const shouldAvoidSkippedPlayers = !skippedSub.executed;
  const skippedOutId = shouldAvoidSkippedPlayers ? skippedSub.playerOut.id : null;
  const skippedInId = shouldAvoidSkippedPlayers ? skippedSub.playerIn.id : null;

  for (const { time, half } of subTimes) {
    // Determine how many subs to make in this window
    const benchAvailable = outfieldPlayers.filter(p => !currentOnPitch.has(p.id));
    const subsThisWindow = Math.min(subsAtOnce, benchAvailable.length, currentOnPitch.size);
    
    const usedPlayerOutIds = new Set<string>();
    const usedPlayerInIds = new Set<string>();
    
    for (let subIdx = 0; subIdx < subsThisWindow; subIdx++) {
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: getPlayer(id)?.minutesPlayed || 0, player: getPlayer(id)! }))
        .filter(p => p.player && !usedPlayerOutIds.has(p.id))
        .sort((a, b) => b.time - a.time);
      
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id) && !usedPlayerInIds.has(p.id))
        .map(p => ({ id: p.id, time: p.minutesPlayed || 0, player: p }))
        .sort((a, b) => a.time - b.time);

      let onPitchCandidates = onPitchSorted;
      let benchCandidates = benchSorted;

      // When skipping a due sub, avoid immediately proposing the same players again
      if (plan.length === 0 && subIdx === 0 && skippedOutId && skippedInId) {
        const filteredOnPitch = onPitchSorted.filter(p => p.id !== skippedOutId);
        const filteredBench = benchSorted.filter(p => p.id !== skippedInId);

        if (filteredOnPitch.length > 0) onPitchCandidates = filteredOnPitch;
        if (filteredBench.length > 0) benchCandidates = filteredBench;
      }
      
      if (onPitchCandidates.length === 0 || benchCandidates.length === 0) break;
      
      // Use 30s minimum threshold — don't swap players with near-equal time
      if (subIdx === 0) {
        const mostPlayed = onPitchCandidates[0];
        const leastPlayed = benchCandidates[0];
        if ((mostPlayed.time - leastPlayed.time) < 30) break;
      }
      
      let playerOut: Player | undefined;
      let playerIn: Player | undefined;
      let positionSwap: SubstitutionEvent["positionSwap"] | undefined;
      
      for (const benchEntry of benchCandidates) {
        for (const pitchEntry of onPitchCandidates) {
          const pitchPos = currentOnPitch.get(pitchEntry.id);
          const timeDiff = pitchEntry.time - benchEntry.time;
          
          // 30s threshold: skip candidates with near-equal playing time
          if (timeDiff < 30) continue;
          
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
        // Fallback: still require 30s threshold
        const fallbackOut = onPitchCandidates[0];
        const fallbackIn = benchCandidates[0];
        if ((fallbackOut.time - fallbackIn.time) >= 30) {
          playerOut = fallbackOut.player;
          playerIn = fallbackIn.player;
        } else {
          break;
        }
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
      usedPlayerOutIds.add(playerOut.id);
      usedPlayerInIds.add(playerIn.id);
      
      const outPos = currentOnPitch.get(playerOut.id);
      currentOnPitch.delete(playerOut.id);
      if (outPos) {
        currentOnPitch.set(playerIn.id, outPos);
      }
    }
  }
  
  return plan;
};
