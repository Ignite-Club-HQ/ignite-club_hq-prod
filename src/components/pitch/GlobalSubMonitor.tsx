import { useEffect, useRef, useCallback, useState } from "react";
import { playSubAlertBeep, playTimerBeep } from "./GameTimer";
import SubConfirmDialog from "./SubConfirmDialog";
import GameFinishedDialog from "./GameFinishedDialog";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { PitchPosition } from "./PositionBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import type { Json } from "@/integrations/supabase/types";
import { setSyncStatus } from "@/hooks/useSyncStatus";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

interface TimerState {
  teamId: string;
  teamName?: string;
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal: boolean;
}

interface PitchBoardState {
  teamId: string;
  players: Player[];
  teamSize: string;
  selectedFormation: number;
  ballPosition: { x: number; y: number };
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  mockMode: boolean;
  lastUpdateTime: number;
  linkedEventId?: string | null;
  executedSubs?: SubstitutionEvent[];
  goals?: Goal[];
}

const TIMER_STATE_KEY = "pitch-board-timer-state";
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_BOARD_OPEN_KEY = "ignite-pitch-board-open";

const loadTimerState = (): TimerState | null => {
  try {
    const saved = localStorage.getItem(TIMER_STATE_KEY);
    if (!saved) return null;
    const state = JSON.parse(saved);
    return {
      teamId: '', // Not stored in timer state, but we don't need it for global check
      ...state,
    } as TimerState;
  } catch {
    return null;
  }
};

const loadPitchState = (): PitchBoardState | null => {
  try {
    const saved = localStorage.getItem(PITCH_STATE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as PitchBoardState;
  } catch {
    return null;
  }
};

const savePitchState = (state: PitchBoardState) => {
  try {
    localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save pitch state:", e);
  }
};

const getTeamSizeNumber = (teamSize: string): number => {
  return parseInt(teamSize) || 11;
};

// Recalculate substitution plan when a sub is skipped
const recalculateRemainingPlan = (
  currentPlayers: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  currentElapsedSeconds: number,
  currentHalf: 1 | 2,
  skippedSub: SubstitutionEvent
): SubstitutionEvent[] => {
  const plan: SubstitutionEvent[] = [];
  
  const playersOnPitch = currentPlayers.filter(p => p.position !== null);
  const benchPlayers = currentPlayers.filter(p => p.position === null);
  
  if (benchPlayers.length === 0) return [];
  
  // Separate GK from outfield players
  const gkOnPitch = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  const gkOnBench = benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1);
  
  const outfieldPlayers = currentPlayers.filter(p => {
    if (p.currentPitchPosition === "GK") return false;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
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
        
        const pitchPlayers = Array.from(currentOnPitch.entries());
        for (const [swapId, swapPos] of pitchPlayers) {
          if (swapId === pitchEntry.id) continue;
          const swapPlayer = getPlayer(swapId);
          if (!swapPlayer) continue;
          
          if (swapPlayer.assignedPositions?.includes(pitchPos!) &&
              benchEntry.player.assignedPositions?.includes(swapPos)) {
            playerOut = pitchEntry.player;
            playerIn = benchEntry.player;
            positionSwap = {
              player: swapPlayer,
              fromPosition: swapPos,
              toPosition: pitchPos!,
            };
            break;
          }
        }
        if (playerOut) break;
      }
      if (playerOut) break;
    }
    
    if (!playerOut && onPitchSorted[0] && benchSorted[0]) {
      playerOut = onPitchSorted[0].player;
      playerIn = benchSorted[0].player;
    }
    
    if (playerOut && playerIn) {
      const incomingPosition = positionSwap 
        ? positionSwap.fromPosition 
        : currentOnPitch.get(playerOut.id);
      
      plan.push({
        time,
        half,
        playerOut,
        playerIn,
        positionSwap,
        executed: false,
      });
      
      currentOnPitch.delete(playerOut.id);
      currentOnPitch.set(playerIn.id, incomingPosition!);
      
      if (positionSwap) {
        currentOnPitch.set(positionSwap.player.id, positionSwap.toPosition);
      }
    }
  }
  
  if (gkOnBench && gkOnPitch && currentHalf === 1) {
    plan.push({
      time: 0,
      half: 2,
      playerOut: gkOnPitch,
      playerIn: gkOnBench,
      executed: false,
    });
  }
  
  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
  return plan;
};

export default function GlobalSubMonitor() {
  const { user } = useAuth();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const [pendingAutoSub, setPendingAutoSub] = useState<SubstitutionEvent | null>(null);
  const [pendingBatchSubs, setPendingBatchSubs] = useState<SubstitutionEvent[]>([]);
  const [subConfirmDialogOpen, setSubConfirmDialogOpen] = useState(false);
  const [currentPlayers, setCurrentPlayers] = useState<Player[]>([]);
  const [gameFinishedOpen, setGameFinishedOpen] = useState(false);
  const [finishedGameData, setFinishedGameData] = useState<{
    players: Player[];
    totalGameTime: number;
    teamName?: string;
    teamId?: string;
    linkedEventId?: string | null;
    formationUsed?: string;
    teamSize?: number;
    executedSubs?: SubstitutionEvent[];
    halfDuration?: number;
    goals?: Goal[];
  } | null>(null);
  const lastCheckedSubRef = useRef<string | null>(null);
  const gameFinishedShownRef = useRef(false);
  const activeGameIdRef = useRef<string | null>(null);

  // Sync game state to database for server-side push notifications
  const syncToDatabase = useCallback(async () => {
    if (!user?.id) {
      console.log('[SYNC] No user logged in, skipping sync');
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    const timerState = loadTimerState();
    const pitchState = loadPitchState();

    console.log('[SYNC] Timer state:', timerState ? {
      isRunning: timerState.isRunning,
      currentHalf: timerState.currentHalf,
      elapsedSeconds: timerState.elapsedSeconds,
      teamId: timerState.teamId,
    } : null);
    console.log('[SYNC] Pitch state:', pitchState ? {
      autoSubActive: pitchState.autoSubActive,
      autoSubPaused: pitchState.autoSubPaused,
      planLength: pitchState.autoSubPlan?.length,
    } : null);

    // If no active game or timer not running with auto-subs, deactivate any existing game
    // Note: We sync even if autoSubPaused is true, so server can track the game
    if (!timerState || !pitchState || !timerState.isRunning || !pitchState.autoSubActive) {
      if (activeGameIdRef.current) {
        console.log('[SYNC] Deactivating game - conditions not met');
        await supabase
          .from('active_games')
          .update({ is_active: false })
          .eq('id', activeGameIdRef.current);
        activeGameIdRef.current = null;
      }
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    // Get team ID from pitch state if not in timer state
    const teamId = timerState.teamId || pitchState.teamId || null;

    const gameData = {
      user_id: user.id,
      team_id: teamId,
      timer_state: {
        ...timerState,
        teamName: timerState.teamName || 'Your team',
      } as unknown as Json,
      pitch_state: pitchState as unknown as Json,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    setSyncStatus({ status: "syncing", lastSyncTime: null });

    try {
      if (activeGameIdRef.current) {
        // Update existing game
        const { error } = await supabase
          .from('active_games')
          .update(gameData)
          .eq('id', activeGameIdRef.current);

        if (error) {
          console.error('[SYNC] Update failed:', error);
          activeGameIdRef.current = null;
          setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: error.message });
        } else {
          console.log('[SYNC] Updated game:', activeGameIdRef.current);
          setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
        }
      } else {
        // Find existing active game or create new one
        const { data: existing } = await supabase
          .from('active_games')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single();

        if (existing) {
          activeGameIdRef.current = existing.id;
          await supabase
            .from('active_games')
            .update(gameData)
            .eq('id', existing.id);
          console.log('[SYNC] Resumed existing game:', existing.id);
          setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
        } else {
          const { data: newGame, error } = await supabase
            .from('active_games')
            .insert(gameData)
            .select()
            .single();

          if (!error && newGame) {
            activeGameIdRef.current = newGame.id;
            console.log('[SYNC] Created new game:', newGame.id);
            setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
          } else if (error) {
            console.error('[SYNC] Insert failed:', error);
            setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: error.message });
          }
        }
      }
    } catch (err) {
      console.error('[SYNC] Error:', err);
      setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: String(err) });
    }
  }, [user?.id]);

  // Create database notification which triggers server-side push via database trigger
  const createPitchBoardNotification = useCallback(async (type: string, message: string) => {
    if (!user?.id) return;
    if (!pitchBoardNotificationsEnabled) return; // Check preference
    
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: user.id,
          type,
          message,
          related_id: null,
        });
      if (error) {
        console.log('Failed to create notification:', error);
      }
    } catch (error) {
      console.log('Notification creation failed:', error);
    }
  }, [user?.id, pitchBoardNotificationsEnabled]);

  // Check for game finished
  const checkForGameFinished = useCallback(() => {
    const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
    if (isPitchBoardOpen) return;
    if (gameFinishedShownRef.current) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState();

    if (!timerState || !pitchState) return;

    // Calculate current elapsed time
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const halfDuration = timerState.minutesPerHalf * 60;

    // Game is finished when 2nd half timer reaches full time
    const isGameFinished = timerState.currentHalf === 2 && currentElapsed >= halfDuration;

    if (isGameFinished) {
      gameFinishedShownRef.current = true;
      
      // Calculate total game time (both halves)
      const totalGameTime = halfDuration * 2;

      // Play finish beep only if sound is enabled
      if (timerState.soundEnabled) {
        try {
          playTimerBeep();
        } catch {
          // Audio may fail silently
        }
      }

      const notificationTitle = "🏆 Game Finished!";
      const notificationBody = timerState.teamName ? `${timerState.teamName} - Full Time` : "Full Time";

      // Show browser notification (only if preference enabled)
      if (pitchBoardNotificationsEnabled) {
        requestNotificationPermission().then(() => {
          showBrowserNotification(notificationTitle, notificationBody);
        });
      }

      // Create database notification (triggers server-side push)
      createPitchBoardNotification('game_finished', notificationBody);

      setFinishedGameData({
        players: pitchState.players,
        totalGameTime,
        teamName: timerState.teamName,
        teamId: pitchState.teamId,
        linkedEventId: pitchState.linkedEventId,
        formationUsed: undefined, // TODO: Add to pitchState if needed
        teamSize: parseInt(pitchState.teamSize) || 7,
        executedSubs: pitchState.executedSubs || pitchState.autoSubPlan?.filter(s => s.executed) || [],
        halfDuration,
        goals: pitchState.goals || [],
      });
      setGameFinishedOpen(true);
    }
  }, [createPitchBoardNotification, pitchBoardNotificationsEnabled]);

  const handleGameFinishedClose = useCallback(() => {
    setGameFinishedOpen(false);
    setFinishedGameData(null);
    gameFinishedShownRef.current = false;
  }, []);

  const checkForPendingSubs = useCallback(() => {
    // Check if pitch board is currently open (it handles its own subs)
    const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
    if (isPitchBoardOpen) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState();

    if (!timerState || !pitchState) return;
    if (!timerState.isRunning) return;
    if (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0) return;
    if (pitchState.autoSubPaused) return;

    // Calculate current elapsed time
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;

    // Find all unexecuted subs for current half that are due
    const dueSubs = pitchState.autoSubPlan.filter(sub => 
      !sub.executed && 
      sub.half === currentHalf && 
      currentElapsed >= sub.time
    );

    if (dueSubs.length > 0) {
      // Group by time - get the earliest and all subs at that time
      const earliestTime = Math.min(...dueSubs.map(s => s.time));
      const batchSubs = dueSubs.filter(s => s.time === earliestTime);
      const [primarySub, ...additionalSubs] = batchSubs;
      
      // Create unique key to avoid duplicate alerts
      const subKey = `${primarySub.half}-${primarySub.time}-batch-${batchSubs.length}`;
      
      if (lastCheckedSubRef.current !== subKey) {
        lastCheckedSubRef.current = subKey;
        
        // Play alert beep with notification
        const notificationBody = batchSubs.length > 1
          ? `Time for ${batchSubs.length} substitutions`
          : `${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} → Bench. ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`} → ${primarySub.playerOut.currentPitchPosition || 'Pitch'}`;
        
        // Request permission if needed, then show notification (only if preference enabled)
        if (pitchBoardNotificationsEnabled) {
          requestNotificationPermission().then(() => {
            // Only play beep if sound is enabled in timer settings
            if (timerState.soundEnabled) {
              try {
                playSubAlertBeep();
              } catch {
                // Audio may fail silently
              }
            }
            showBrowserNotification("🔄 Substitution Alert", notificationBody);
          });
        }
        
        // Create database notification (triggers server-side push)
        createPitchBoardNotification('pending_sub', notificationBody);
        
        // Set up dialog with batch subs
        setCurrentPlayers(pitchState.players);
        setPendingAutoSub(primarySub);
        setPendingBatchSubs(additionalSubs);
        setSubConfirmDialogOpen(true);
      }
    }
  }, [createPitchBoardNotification, pitchBoardNotificationsEnabled]);

  // Check if there's an active game that needs monitoring
  const hasActiveGame = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState();
    
    if (!timerState || !pitchState) return false;
    
    // Also need to monitor for game finish even if subs not active
    if (timerState.isRunning) return true;
    
    if (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0) return false;
    if (pitchState.autoSubPaused) return false;
    
    return true;
  }, []);

  // Set up smart polling - only when needed
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let syncIntervalId: ReturnType<typeof setInterval> | null = null;
    
    const startPolling = () => {
      const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
      const gameActive = hasActiveGame();
      
      // Sub checking only when pitch board is closed (it handles its own subs)
      if (!isPitchBoardOpen && gameActive) {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => {
          checkForPendingSubs();
          checkForGameFinished();
        }, 5000);
        checkForPendingSubs();
        checkForGameFinished();
      } else if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      
      // Database sync runs whether pitch board is open or closed (for background notifications)
      if (gameActive && !syncIntervalId) {
        console.log('[SYNC] Starting sync interval');
        syncToDatabase(); // Immediate sync
        syncIntervalId = setInterval(syncToDatabase, 10000); // Sync every 10s
      } else if (!gameActive && syncIntervalId) {
        console.log('[SYNC] Stopping sync interval - no active game');
        clearInterval(syncIntervalId);
        syncIntervalId = null;
        setSyncStatus({ status: "idle", lastSyncTime: null });
      }
    };
    
    // Check when visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        // When app goes to background, do one final sync
        syncToDatabase();
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    };
    
    // Listen for storage changes to detect game state changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TIMER_STATE_KEY || e.key === PITCH_STATE_KEY || e.key === PITCH_BOARD_OPEN_KEY) {
        startPolling();
        syncToDatabase(); // Sync on state change
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);
    
    // Initial setup
    startPolling();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (syncIntervalId) clearInterval(syncIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkForPendingSubs, checkForGameFinished, hasActiveGame, syncToDatabase]);

  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const pitchState = loadPitchState();
    if (!pitchState) return;

    const { playerOut, playerIn, positionSwap } = pendingAutoSub;
    
    // Find current player positions
    const currentPlayerOut = pitchState.players.find(p => p.id === playerOut.id);
    const currentPlayerIn = pitchState.players.find(p => p.id === playerIn.id);
    
    // CRITICAL: Validate both players exist and are in correct positions before executing
    // playerOut must be on pitch (position !== null)
    // playerIn must be on bench (position === null)
    
    // If playerIn doesn't exist or is already on pitch, skip without modifying positions
    if (!currentPlayerIn || currentPlayerIn.position !== null) {
      console.log('[GlobalSubMonitor] Skipping sub - playerIn not on bench:', {
        playerIn: playerIn.name,
        found: !!currentPlayerIn,
        position: currentPlayerIn?.position
      });
      // Mark as executed but DON'T change any player positions
      const updatedPlan = pitchState.autoSubPlan.map(sub => {
        if (sub.time === pendingAutoSub.time && 
            sub.half === pendingAutoSub.half && 
            sub.playerOut.id === pendingAutoSub.playerOut.id) {
          return { ...sub, executed: true };
        }
        return sub;
      });
      
      savePitchState({
        ...pitchState,
        autoSubPlan: updatedPlan,
        autoSubActive: updatedPlan.filter(sub => !sub.executed).length > 0,
        lastUpdateTime: Date.now(),
      });
      
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      lastCheckedSubRef.current = null;
      return;
    }
    
    // If playerOut doesn't exist or is already off pitch, skip without modifying positions
    if (!currentPlayerOut || currentPlayerOut.position === null) {
      console.log('[GlobalSubMonitor] Skipping sub - playerOut not on pitch:', {
        playerOut: playerOut.name,
        found: !!currentPlayerOut,
        position: currentPlayerOut?.position
      });
      // Mark as executed but DON'T change any player positions
      const updatedPlan = pitchState.autoSubPlan.map(sub => {
        if (sub.time === pendingAutoSub.time && 
            sub.half === pendingAutoSub.half && 
            sub.playerOut.id === pendingAutoSub.playerOut.id) {
          return { ...sub, executed: true };
        }
        return sub;
      });
      
      savePitchState({
        ...pitchState,
        autoSubPlan: updatedPlan,
        autoSubActive: updatedPlan.filter(sub => !sub.executed).length > 0,
        lastUpdateTime: Date.now(),
      });
      
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      lastCheckedSubRef.current = null;
      return;
    }
    
    // Both players are valid - currentPlayerOut is on pitch, currentPlayerIn is on bench
    // (we already validated this above, so currentPlayerIn is guaranteed to exist)
    
    const pitchPosition = { ...currentPlayerOut.position };
    const pitchPositionType = currentPlayerOut.currentPitchPosition;
    
    let updatedPlayers = pitchState.players;
    
    if (positionSwap) {
      const swapPlayer = pitchState.players.find(p => p.id === positionSwap.player.id);
      if (swapPlayer?.position) {
        const swapPosition = { ...swapPlayer.position };
        
        updatedPlayers = pitchState.players.map(p => {
          if (p.id === playerOut.id) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === positionSwap.player.id) {
            return { ...p, position: pitchPosition, currentPitchPosition: positionSwap.toPosition };
          }
          if (p.id === playerIn.id) {
            return { ...p, position: swapPosition, currentPitchPosition: positionSwap.fromPosition };
          }
          return p;
        });
      } else {
        // Swap player no longer on pitch - just do simple swap
        updatedPlayers = pitchState.players.map(p => {
          if (p.id === playerOut.id) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === playerIn.id) {
            return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
          }
          return p;
        });
      }
    } else {
      updatedPlayers = pitchState.players.map(p => {
        if (p.id === playerOut.id) {
          return { ...p, position: null, currentPitchPosition: undefined };
        }
        if (p.id === playerIn.id) {
          return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        }
        return p;
      });
    }
    
    // Mark sub as executed and update players
    const updatedPlan = pitchState.autoSubPlan.map(sub => {
      if (sub.time === pendingAutoSub.time && 
          sub.half === pendingAutoSub.half && 
          sub.playerOut.id === pendingAutoSub.playerOut.id) {
        return { ...sub, executed: true };
      }
      return sub;
    });
    
    // Check if all subs are done
    const remainingSubs = updatedPlan.filter(sub => !sub.executed);
    
    savePitchState({
      ...pitchState,
      players: updatedPlayers,
      autoSubPlan: updatedPlan,
      autoSubActive: remainingSubs.length > 0,
      lastUpdateTime: Date.now(),
    });
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub, pendingBatchSubs]);

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const pitchState = loadPitchState();
    const timerState = loadTimerState();
    if (!pitchState || !timerState) return;
    
    // Recalculate remaining plan instead of just marking as executed
    // This ensures equal playing time is maintained
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;
    const halfDurationSeconds = timerState.minutesPerHalf * 60;
    
    const benchPlayers = pitchState.players.filter(p => p.position === null);
    
    if (benchPlayers.length > 0) {
      // Recalculate plan from current state
      const recalculatedPlan = recalculateRemainingPlan(
        pitchState.players,
        getTeamSizeNumber(pitchState.teamSize),
        halfDurationSeconds,
        currentElapsed,
        currentHalf,
        pendingAutoSub
      );
      
      savePitchState({
        ...pitchState,
        autoSubPlan: recalculatedPlan,
        autoSubActive: recalculatedPlan.length > 0,
        lastUpdateTime: Date.now(),
      });
    } else {
      // No bench players left, just remove the skipped sub
      const updatedPlan = pitchState.autoSubPlan.filter(sub => 
        !(sub.time === pendingAutoSub.time && 
          sub.half === pendingAutoSub.half && 
          sub.playerOut.id === pendingAutoSub.playerOut.id)
      );
      
      savePitchState({
        ...pitchState,
        autoSubPlan: updatedPlan,
        autoSubActive: updatedPlan.filter(s => !s.executed).length > 0,
        lastUpdateTime: Date.now(),
      });
    }
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub]);

  return (
    <>
      <SubConfirmDialog
        open={subConfirmDialogOpen}
        onOpenChange={setSubConfirmDialogOpen}
        substitution={pendingAutoSub}
        batchSubstitutions={pendingBatchSubs}
        onConfirm={handleConfirmAutoSub}
        onSkip={handleSkipAutoSub}
        players={currentPlayers}
      />
      {finishedGameData && (
        <GameFinishedDialog
          open={gameFinishedOpen}
          onClose={handleGameFinishedClose}
          players={finishedGameData.players}
          totalGameTime={finishedGameData.totalGameTime}
          teamName={finishedGameData.teamName}
          linkedEventId={finishedGameData.linkedEventId}
          teamId={finishedGameData.teamId}
          formationUsed={finishedGameData.formationUsed}
          teamSize={finishedGameData.teamSize}
          executedSubs={finishedGameData.executedSubs}
          halfDuration={finishedGameData.halfDuration}
          goals={finishedGameData.goals}
        />
      )}
    </>
  );
}
