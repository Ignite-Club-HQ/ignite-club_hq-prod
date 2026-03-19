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
    const state = JSON.parse(saved);
    return {
      teamId: '', // Not stored in timer state, but we don't need it for global check
      ...state,
    } as TimerState;
  } catch {
    return null;
  }
};

const loadPitchState = (teamId?: string): PitchBoardState | null => {
  try {
    // Try team-specific key first for isolation
    if (teamId) {
      const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
      if (teamSaved) return JSON.parse(teamSaved) as PitchBoardState;
    }
    // Fallback to active key
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
    if (!timerState.isRunning) return;
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

    // Find all unexecuted subs for current half that are due
    const dueSubs = pitchState.autoSubPlan.filter(sub => 
      !sub.executed && 
      sub.half === currentHalf && 
      currentElapsed >= sub.time
    );

    if (dueSubs.length > 0) {
      // Check for multiple time groups — auto-skip older ones
      const dueTimes = [...new Set(dueSubs.map(s => s.time))].sort((a, b) => a - b);
      
      if (dueTimes.length > 1) {
        // Skip all but the latest time group
        const latestTime = dueTimes[dueTimes.length - 1];
        const olderSubs = dueSubs.filter(s => s.time < latestTime);
        const olderKeys = new Set(olderSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}`));
        const updatedPlan = pitchState.autoSubPlan.map(s =>
          olderKeys.has(`${s.half}-${s.time}-${s.playerOut.id}`) ? { ...s, executed: true, skipped: true } : s
        );
        savePitchState({ ...pitchState, autoSubPlan: updatedPlan });
        return; // Next tick will handle the latest due sub
      }
      
      // All due subs are at the same time
      const batchSubs = dueSubs;
      const [primarySub, ...additionalSubs] = batchSubs;
      
      // Create unique key to avoid duplicate alerts
      const subKey = `${primarySub.half}-${primarySub.time}-batch-${batchSubs.length}`;
      
      if (lastCheckedSubRef.current !== subKey) {
        lastCheckedSubRef.current = subKey;
        
        // Play alert beep (dialog itself is the in-app alert)
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
    const pitchState = loadPitchState(timerState?.teamId);
    
    if (!timerState || !pitchState) return false;
    
    // Also need to monitor for game finish even if subs not active
    if (timerState.isRunning) return true;
    
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
        const olderKeys = new Set(olderSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}`));
        const latestMissedSub = olderSubs[olderSubs.length - 1];

        let updatedPlan = (pitchState.autoSubPlan || []).map(s =>
          olderKeys.has(`${s.half}-${s.time}-${s.playerOut.id}`) ? { ...s, executed: true, skipped: true } : s
        );

        if (latestMissedSub) {
          const executedSubs = updatedPlan.filter(s => s.executed);
          const currentDueSubs = updatedPlan.filter(s => !s.executed && s.half === currentHalf && s.time === latestTime);
          const futureSubsExist = updatedPlan.some(s => !s.executed && !(s.half === currentHalf && s.time === latestTime));

          if (futureSubsExist) {
                // Simulate currentDueSubs on the players array so recalculation
                // doesn't re-use players already queued in current due subs
                let simulatedPlayers = [...pitchState.players];
                currentDueSubs.forEach(dueSub => {
                  const outPlayer = simulatedPlayers.find(p => p.id === dueSub.playerOut.id);
                  const inPlayer = simulatedPlayers.find(p => p.id === dueSub.playerIn.id);
                  if (outPlayer && inPlayer && outPlayer.position) {
                    simulatedPlayers = simulatedPlayers.map(p => {
                      if (p.id === dueSub.playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
                      if (p.id === dueSub.playerIn.id) return { ...p, position: outPlayer.position, currentPitchPosition: outPlayer.currentPitchPosition };
                      return p;
                    });
                  }
                });

                const recalculated = recalculateRemainingPlan(
                  simulatedPlayers,
                  getTeamSizeNumber(pitchState.teamSize),
                  timerState.minutesPerHalf * 60,
                  currentElapsed,
                  currentHalf,
                  latestMissedSub,
                  true
                );

                updatedPlan = [...executedSubs, ...currentDueSubs, ...recalculated];
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
      
      if (delaySeconds > 30) {
        console.log(`[GlobalSubMonitor] Sub was ${Math.round(delaySeconds / 60)}m late, recalculating remaining plan`);
        const executedPlan = finalPlan.filter(sub => sub.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          getTeamSizeNumber(pitchState.teamSize),
          halfDuration,
          currentElapsed,
          timerState.currentHalf as 1 | 2,
          { ...pendingAutoSub, executed: true },
          true
        );
        finalPlan = [...executedPlan, ...recalculated];
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

    // Recalculate remaining plan after skip
    let finalPlan = updatedPlan;
    if (timerState && updatedPlan.some(sub => !sub.executed)) {
      const now = Date.now();
      const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
      const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
      const halfDuration = timerState.minutesPerHalf * 60;
      
      const recalculated = recalculateRemainingPlan(
        pitchState.players,
        getTeamSizeNumber(pitchState.teamSize),
        halfDuration,
        currentElapsed,
        timerState.currentHalf as 1 | 2,
        pendingAutoSub,
        true
      );
      
      const executedSubs = updatedPlan.filter(sub => sub.executed);
      finalPlan = [...executedSubs, ...recalculated];
    }

    // Always validate after recalculation
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
