import { useEffect, useRef, useCallback, useState } from "react";
import { playSubAlertBeep, playTimerBeep } from "./GameTimer";
import SubConfirmDialog from "./SubConfirmDialog";
import GameFinishedDialog from "./GameFinishedDialog";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import type { Json } from "@/integrations/supabase/types";
import { setSyncStatus } from "@/hooks/useSyncStatus";
import { recalculateRemainingPlanTeamAware as recalculateRemainingPlan, validateAndFixRemainingPlan } from "./pitchStateUtils";
import type { Player, SubstitutionEvent, TimerState, PitchBoardState, Goal } from "./types";
import {
  PITCH_STATE_KEY,
  PITCH_STATE_KEY_BASE,
  getPitchStateKey,
  PITCH_BOARD_OPEN_KEY,
  TIMER_STORAGE_KEY,
} from "./types";
import { getSubKey, executeSubsOnPlayers, markSubsExecuted, calculateSubDelay } from "./autoSubHelpers";

const TIMER_STATE_KEY = TIMER_STORAGE_KEY;
const getPitchStateKeyForTeam = getPitchStateKey;

const loadTimerState = (): TimerState | null => {
  try {
    const saved = localStorage.getItem(TIMER_STATE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as TimerState;
  } catch {
    return null;
  }
};

const loadPitchState = (teamId?: string): PitchBoardState | null => {
  try {
    if (teamId) {
      const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
      if (teamSaved) return JSON.parse(teamSaved) as PitchBoardState;

      const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
      if (!activeSaved) return null;
      const activeState = JSON.parse(activeSaved) as PitchBoardState;
      return activeState.teamId === teamId ? activeState : null;
    }

    const saved = localStorage.getItem(PITCH_STATE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as PitchBoardState;
  } catch {
    return null;
  }
};

const savePitchState = (state: PitchBoardState) => {
  try {
    const json = JSON.stringify(state);
    // Write to team-specific key if teamId available
    if (state.teamId) {
      localStorage.setItem(getPitchStateKeyForTeam(state.teamId), json);
    }
    // Also write to active key
    localStorage.setItem(PITCH_STATE_KEY, json);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'pitch-monitor' } }));
  } catch (e) {
    console.error("Failed to save pitch state:", e);
  }
};

const getTeamSizeNumber = (teamSize: string): number => {
  return parseInt(teamSize) || 11;
};

// recalculateRemainingPlan is imported from pitchStateUtils

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
    eventTitle?: string;
    eventDate?: string;
    opponent?: string;
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
    const pitchState = loadPitchState(timerState?.teamId);

    console.log('[SYNC] Timer state:', timerState ? {
      isRunning: timerState.isRunning,
      currentHalf: timerState.currentHalf,
      elapsedSeconds: timerState.elapsedSeconds,
      minutesPerHalf: timerState.minutesPerHalf,
      teamId: timerState.teamId,
    } : null);
    console.log('[SYNC] Pitch state:', pitchState ? {
      autoSubActive: pitchState.autoSubActive,
      autoSubPaused: pitchState.autoSubPaused,
      planLength: pitchState.autoSubPlan?.length,
    } : null);

    // If no active game or timer not running with auto-subs, deactivate any existing game
    // Note: We sync even if autoSubPaused is true, so server can track the game
    // CRITICAL: Also check if the game is actually finished — if so, don't re-sync as active.
    // This prevents resurrecting finished games which causes duplicate full-time notifications.
    const halfDurationSecs = timerState ? timerState.minutesPerHalf * 60 : 0;
    const secondsSinceUpdate = timerState?.lastUpdateTime
      ? Math.max(0, Math.floor((Date.now() - timerState.lastUpdateTime) / 1000))
      : 0;
    const projectedElapsed = timerState
      ? timerState.elapsedSeconds + (timerState.isRunning ? secondsSinceUpdate : 0)
      : 0;
    const isFinished = timerState
      ? (Boolean((timerState as any).isGameFinished) ||
         (timerState.currentHalf === 2 && projectedElapsed >= halfDurationSecs))
      : false;

    if (!timerState || !pitchState || !timerState.isRunning || !pitchState.autoSubActive || isFinished) {
      if (activeGameIdRef.current) {
        console.log('[SYNC] Deactivating game - conditions not met', { isFinished });
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
    
    // Skip syncing to active_games for event-group based games
    // Those are synced via useEventGroupSync to the event_groups table
    const isEventGroup = typeof teamId === 'string' && teamId.startsWith("event-group-");
    if (isEventGroup) {
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

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
  const checkForGameFinished = useCallback(async () => {
    const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
    if (isPitchBoardOpen) return;
    if (gameFinishedShownRef.current) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);

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

      // Fetch event details if linked
      let eventTitle: string | undefined;
      let eventDate: string | undefined;
      let opponent: string | undefined;

      if (pitchState.linkedEventId) {
        try {
          const { data: eventData } = await supabase
            .from('events')
            .select('title, event_date, opponent')
            .eq('id', pitchState.linkedEventId)
            .single();
          
          if (eventData) {
            eventTitle = eventData.title;
            eventDate = eventData.event_date ? new Date(eventData.event_date).toLocaleDateString() : undefined;
            opponent = eventData.opponent || undefined;
          }
        } catch (err) {
          console.error('[GAME] Error fetching event details:', err);
        }
      }

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
        eventTitle,
        eventDate,
        opponent,
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
    const pitchState = loadPitchState(timerState?.teamId);

    if (!timerState || !pitchState) return;
    if (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0) return;
    if (pitchState.autoSubPaused) return;

    // Calculate current elapsed time
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;

    // Don't show sub notifications if game is finished
    const halfDuration = timerState.minutesPerHalf * 60;
    if (timerState.currentHalf === 2 && currentElapsed >= halfDuration) return;

    // Check for halftime subs during the break (timer stopped, half=2, elapsed=0)
    const isHalftimeBreak = !timerState.isRunning && currentHalf === 2 && currentElapsed === 0;
    
    if (isHalftimeBreak) {
      const staleFirstHalfSubs = pitchState.autoSubPlan.filter(sub => !sub.executed && sub.half === 1);
      const halftimeSubs = pitchState.autoSubPlan.filter(sub =>
        !sub.executed && sub.half === 2 && sub.time === 0
      );

      let nextPitchState = pitchState;
      if (staleFirstHalfSubs.length > 0) {
        const staleKeys = staleFirstHalfSubs.map(getSubKey);
        const updatedPlan = markSubsExecuted(pitchState.autoSubPlan, staleKeys, true);
        nextPitchState = { ...pitchState, autoSubPlan: updatedPlan, lastUpdateTime: Date.now() };
        savePitchState(nextPitchState);
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        lastCheckedSubRef.current = null;
      }

      if (halftimeSubs.length > 0) {
        const [primarySub, ...additionalSubs] = halftimeSubs;
        const subKey = `halftime-batch-${halftimeSubs.length}`;
        if (lastCheckedSubRef.current !== subKey) {
          lastCheckedSubRef.current = subKey;
          if (timerState.soundEnabled) {
            try { playSubAlertBeep(); } catch { /* Audio may fail */ }
          }
          setCurrentPlayers(nextPitchState.players);
          setPendingAutoSub(primarySub);
          setPendingBatchSubs(additionalSubs);
          setSubConfirmDialogOpen(true);
        }
      } else {
        // No halftime subs — still show a halftime notification
        const subKey = `halftime-no-subs`;
        if (lastCheckedSubRef.current !== subKey) {
          lastCheckedSubRef.current = subKey;
          if (timerState.soundEnabled) {
            try { playSubAlertBeep(); } catch { /* Audio may fail */ }
          }
          setCurrentPlayers(nextPitchState.players);
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }
      }
      return;
    }

    // For non-halftime subs, timer must be running
    if (!timerState.isRunning) return;

    // Find all unexecuted subs for current half that are due
    const dueSubs = pitchState.autoSubPlan.filter(sub => 
      !sub.executed && 
      sub.half === currentHalf && 
      currentElapsed >= sub.time
    );

    if (dueSubs.length > 0) {
      let activePitchState = pitchState;
      let batchSubs = dueSubs;

      const dueTimes = [...new Set(dueSubs.map(s => s.time))].sort((a, b) => a - b);
      if (dueTimes.length > 1) {
        const latestTime = dueTimes[dueTimes.length - 1];
        const olderSubs = dueSubs.filter(s => s.time < latestTime);

        if (olderSubs.length > 0) {
          const olderKeys = olderSubs.map(s => getSubKey(s));
          const updatedPlan = markSubsExecuted(pitchState.autoSubPlan, olderKeys, true);
          activePitchState = { ...pitchState, autoSubPlan: updatedPlan };
          savePitchState(activePitchState);
          batchSubs = updatedPlan.filter(
            sub => !sub.executed && sub.half === currentHalf && sub.time === latestTime
          );
        }
      }

      if (batchSubs.length === 0) return;

      const [primarySub, ...additionalSubs] = batchSubs;
      const subKey = `${primarySub.half}-${primarySub.time}-batch-${batchSubs.length}`;

      if (lastCheckedSubRef.current !== subKey) {
        lastCheckedSubRef.current = subKey;

        const notificationBody = batchSubs.length > 1
          ? `Time for ${batchSubs.length} substitutions`
          : `${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} → Bench. ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`} → ${primarySub.playerOut.currentPitchPosition || 'Unknown'}`;

        if (timerState.soundEnabled) {
          try {
            playSubAlertBeep();
          } catch {
            // Audio may fail silently
          }
        }

        // IMPORTANT: Do not create browser/DB notifications here.
        // Server-side check-pending-subs already sends pending_sub notifications,
        // and triggering them here causes duplicate device notifications.

        setCurrentPlayers(activePitchState.players);
        setPendingAutoSub(primarySub);
        setPendingBatchSubs(additionalSubs);
        setSubConfirmDialogOpen(true);
      }
    }
  }, [createPitchBoardNotification, pitchBoardNotificationsEnabled]);

  // Check if there's an active game that needs monitoring
  const hasActiveGame = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    
    if (!timerState || !pitchState) return false;
    
    // Monitor when timer is running
    if (timerState.isRunning) return true;
    
    // Monitor during halftime break (half=2, elapsed=0, not running) — always show halftime popup
    if (!timerState.isRunning && timerState.currentHalf === 2 && timerState.elapsedSeconds === 0) {
      if (pitchState.autoSubActive) {
        return true;
      }
    }
    
    if (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0) return false;
    if (pitchState.autoSubPaused) return false;
    
    return true;
  }, []);

  // Force-open sub confirmation from notification click
  const forceOpenSubConfirmation = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState || !timerState) return;

    // Calculate current elapsed time
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;

    // Find unexecuted subs that are due
    const dueSubs = pitchState.autoSubPlan?.filter(sub => 
      !sub.executed && 
      sub.half === currentHalf && 
      currentElapsed >= sub.time
    ) || [];

    if (dueSubs.length > 0) {
      // Auto-skip older time groups, then rebuild future subs from the current game state.
      const dueTimes = [...new Set(dueSubs.map(s => s.time))].sort((a, b) => a - b);
      let nextPitchState = pitchState;
      let latestTime = Math.max(...dueSubs.map(s => s.time));

      if (dueTimes.length > 1) {
        latestTime = dueTimes[dueTimes.length - 1];
        const olderSubs = dueSubs.filter(s => s.time < latestTime);
        const olderKeys = olderSubs.map(s => getSubKey(s));
        const latestMissedSub = olderSubs[olderSubs.length - 1];

        let updatedPlan = markSubsExecuted(pitchState.autoSubPlan || [], olderKeys, true);

        if (latestMissedSub) {
          const executedSubs = updatedPlan.filter(s => s.executed);
          const currentDueSubs = updatedPlan.filter(s => !s.executed && s.half === currentHalf && s.time === latestTime);
          const futureSubsExist = updatedPlan.some(s => !s.executed && !(s.half === currentHalf && s.time === latestTime));

          if (futureSubsExist) {
                // Simulate currentDueSubs on the players array using shared helper
                const { updatedPlayers: simulatedPlayers } = executeSubsOnPlayers(currentDueSubs, pitchState.players);
                const existingFutureSubs = updatedPlan.filter(s => !s.executed && !(s.half === currentHalf && s.time === latestTime));

                const recalculated = recalculateRemainingPlan(
                  simulatedPlayers,
                  getTeamSizeNumber(pitchState.teamSize),
                  timerState.minutesPerHalf * 60,
                  currentElapsed,
                  currentHalf,
                  latestMissedSub,
                  true
                );

                // Safety guard: preserve existing future subs if recalculation shrinks the plan
                if (recalculated.length >= existingFutureSubs.length || existingFutureSubs.length === 0) {
                  updatedPlan = [...executedSubs, ...currentDueSubs, ...recalculated];
                } else {
                  const benchPlayers = simulatedPlayers.filter((p: Player) => p.position === null && !p.isInjured);
                  if (benchPlayers.length > 0 && recalculated.length === 0) {
                    console.warn("[GlobalSubMonitor] Auto-skip recalculation returned empty — preserving existing future subs");
                    updatedPlan = [...executedSubs, ...currentDueSubs, ...existingFutureSubs];
                  } else {
                    console.warn("[GlobalSubMonitor] Auto-skip recalculation shortened plan — preserving existing future subs");
                    updatedPlan = [...executedSubs, ...currentDueSubs, ...existingFutureSubs];
                  }
                }
              }
        }

        nextPitchState = { ...pitchState, autoSubPlan: updatedPlan };
        savePitchState(nextPitchState);
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      }

      const refreshedDueSubs = nextPitchState.autoSubPlan?.filter(sub =>
        !sub.executed &&
        sub.half === currentHalf &&
        currentElapsed >= sub.time &&
        sub.time === latestTime
      ) || [];
      const [primarySub, ...additionalSubs] = refreshedDueSubs;
      setCurrentPlayers(nextPitchState.players);
      setPendingAutoSub(primarySub);
      setPendingBatchSubs(additionalSubs);
      setSubConfirmDialogOpen(true);
      return;
    }

    // No pending subs - show the most recent executed sub in read-only mode
    const executedSubs = pitchState.autoSubPlan?.filter(s => s.executed) || [];
    if (executedSubs.length > 0) {
      const lastExecuted = executedSubs[executedSubs.length - 1];
      setCurrentPlayers(pitchState.players);
      setPendingAutoSub(lastExecuted);
      setPendingBatchSubs([]);
      setSubConfirmDialogOpen(true);
    }
  }, []);


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
    
    // Check when visibility changes - critical for mobile where background intervals are throttled
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediately sync on foreground return to refresh updated_at
        // This prevents the edge function from marking the game as stale
        syncToDatabase();
        startPolling();
      } else {
        // When app goes to background, do one final sync
        syncToDatabase();
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        // Keep syncIntervalId running - even if throttled, it will fire eventually
      }
    };
    
    // Capacitor native app state change - more reliable than visibilitychange on Android
    let appStateListener: any = null;
    const setupNativeListener = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        appStateListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            console.log('[SYNC] Native app resumed - forcing sync');
            syncToDatabase();
            startPolling();
          } else {
            console.log('[SYNC] Native app backgrounded - final sync');
            syncToDatabase();
          }
        });
      } catch {
        // Not in Capacitor - that's fine, visibilitychange will handle it
      }
    };
    setupNativeListener();
    
    // Listen for storage changes to detect game state changes (cross-tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TIMER_STATE_KEY || e.key?.startsWith(PITCH_STATE_KEY) || e.key === PITCH_BOARD_OPEN_KEY) {
        startPolling();
        syncToDatabase(); // Sync on state change
      }
    };
    
    // Listen for same-tab game state changes (critical for Android WebView
    // where StorageEvent doesn't fire for same-window localStorage writes)
    const handleGameStateChanged = () => {
      startPolling();
      syncToDatabase();
    };
    
    // Listen for notification clicks requesting sub confirmation
    const handleOpenSubConfirmation = () => forceOpenSubConfirmation();
    window.addEventListener('open-sub-confirmation', handleOpenSubConfirmation);
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('game-state-changed', handleGameStateChanged);
    
    // Initial setup
    startPolling();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (syncIntervalId) clearInterval(syncIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('game-state-changed', handleGameStateChanged);
      window.removeEventListener('open-sub-confirmation', handleOpenSubConfirmation);
      appStateListener?.remove?.();
    };
  }, [checkForPendingSubs, checkForGameFinished, hasActiveGame, syncToDatabase]);

  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState) return;

    // Guard: check if this sub was already skipped
    const matchingSub = pitchState.autoSubPlan?.find(s =>
      s.playerOut.id === pendingAutoSub.playerOut.id && 
      s.time === pendingAutoSub.time && 
      s.half === pendingAutoSub.half
    );
    if (matchingSub?.executed || matchingSub?.skipped) {
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      lastCheckedSubRef.current = null;
      return;
    }

    // Use shared helper to execute subs
    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    const { updatedPlayers, executedSubKeys } = executeSubsOnPlayers(allPendingSubs, pitchState.players);

    // Mark processed subs as executed
    let finalPlan = markSubsExecuted(pitchState.autoSubPlan, executedSubKeys);
    
    // Recalculate if significantly late (>30s)
    if (timerState && finalPlan.some(sub => !sub.executed)) {
      const now = Date.now();
      const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
      const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
      const halfDuration = timerState.minutesPerHalf * 60;
      const delaySeconds = calculateSubDelay(pendingAutoSub, currentElapsed, timerState.currentHalf as 1 | 2, halfDuration);
      
      // Also detect early execution
      const scheduledTime = pendingAutoSub.time;
      const earlyBySeconds = pendingAutoSub.half === (timerState.currentHalf as 1 | 2)
        ? Math.max(0, scheduledTime - currentElapsed)
        : 0;
      const isSignificantlyEarly = earlyBySeconds > 15;
      const isSignificantlyLate = delaySeconds > 30;

      if (isSignificantlyLate || isSignificantlyEarly) {
        console.log(`[GlobalSubMonitor] Sub was ${isSignificantlyLate ? Math.round(delaySeconds / 60) + 'm late' : Math.round(earlyBySeconds) + 's early'}, recalculating remaining plan`);
        const executedPlan = finalPlan.filter(sub => sub.executed);
        const remainingSubs = finalPlan.filter(sub => !sub.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          getTeamSizeNumber(pitchState.teamSize),
          halfDuration,
          currentElapsed,
          timerState.currentHalf as 1 | 2,
          { ...pendingAutoSub, executed: true },
          true
        );
        // Safety guard: don't let recalculation wipe the plan
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedPlan, ...recalculated];
        } else {
          const benchPlayers = updatedPlayers.filter((p: Player) => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[GlobalSubMonitor] Recalculation returned empty but bench players remain — preserving existing plan");
            finalPlan = [...executedPlan, ...remainingSubs];
          } else {
            finalPlan = [...executedPlan, ...recalculated];
          }
        }
      }
    }

    // Always validate remaining plan against updated player positions
    finalPlan = validateAndFixRemainingPlan(finalPlan, updatedPlayers);
    
    savePitchState({
      ...pitchState,
      players: updatedPlayers,
      autoSubPlan: finalPlan,
      autoSubActive: pitchState.autoSubActive,
      lastUpdateTime: Date.now(),
    });
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub, pendingBatchSubs]);

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState) return;

    const subsToSkip = [pendingAutoSub, ...pendingBatchSubs];
    const skippedKeys = subsToSkip.map(sub => getSubKey(sub));

    let updatedPlan = markSubsExecuted(pitchState.autoSubPlan, skippedKeys, true);
    const existingUnexecuted = updatedPlan.filter(sub => !sub.executed);
    const executedSubs = updatedPlan.filter(sub => sub.executed);

    let finalPlan = updatedPlan;

    if (timerState && existingUnexecuted.length > 0) {
      const now = Date.now();
      const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
      const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
      const halfDuration = timerState.minutesPerHalf * 60;
      const currentHalf = timerState.currentHalf as 1 | 2;

      // Only recalculate if the skip was significantly late (>30s overdue)
      const shouldRecalculate = subsToSkip.some(sub =>
        calculateSubDelay(sub, currentElapsed, currentHalf, halfDuration) > 30
      );

      if (shouldRecalculate) {
        const recalculated = recalculateRemainingPlan(
          pitchState.players,
          getTeamSizeNumber(pitchState.teamSize),
          halfDuration,
          currentElapsed,
          currentHalf,
          pendingAutoSub,
          true
        );

        // Safety guard: if recalculation shrinks the plan, preserve existing schedule
        if (recalculated.length >= existingUnexecuted.length || existingUnexecuted.length === 0) {
          finalPlan = [...executedSubs, ...recalculated];
        } else {
          // Check if bench players still exist — only preserve if they do
          const benchPlayers = pitchState.players.filter((p: Player) => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0 && recalculated.length === 0) {
            console.warn("[GlobalSubMonitor] Recalculation returned empty but bench players remain — preserving existing plan");
            finalPlan = [...executedSubs, ...existingUnexecuted];
          } else {
            console.warn("[GlobalSubMonitor] Recalculation shortened plan — preserving existing plan");
            finalPlan = [...executedSubs, ...existingUnexecuted];
          }
        }
      } else {
        // Not significantly late — just keep the existing unexecuted subs
        finalPlan = [...executedSubs, ...existingUnexecuted];
      }
    }

    // Always validate after any plan change
    finalPlan = validateAndFixRemainingPlan(finalPlan, pitchState.players);

    savePitchState({
      ...pitchState,
      autoSubPlan: finalPlan,
      autoSubActive: pitchState.autoSubActive,
      lastUpdateTime: Date.now(),
    });
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub, pendingBatchSubs]);

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
          eventTitle={finishedGameData.eventTitle}
          eventDate={finishedGameData.eventDate}
          opponent={finishedGameData.opponent}
        />
      )}
    </>
  );
}
