import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { Json } from "@/integrations/supabase/types";

const SYNC_INTERVAL = 10000; // Sync every 10 seconds
const TIMER_STATE_KEY = "pitch-board-timer-state";
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;

interface TimerState {
  elapsedSeconds: number;
  isRunning: boolean;
  currentHalf: number;
  minutesPerHalf: number;
  lastUpdateTime: number;
  teamName?: string;
  teamId?: string;
}

interface PitchState {
  players: any[];
  autoSubPlan: any[];
  autoSubActive: boolean;
  autoSubPaused?: boolean;
}

/**
 * Hook to sync active game state to the database for server-side push notifications.
 * This enables push notifications even when the app is closed.
 */
export function useActiveGameSync() {
  const { user } = useAuth();
  const activeGameIdRef = useRef<string | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const deactivateOtherActiveGames = useCallback(async (currentGameId?: string | null) => {
    if (!user?.id) return;

    let query = supabase
      .from('active_games')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (currentGameId) {
      query = query.neq('id', currentGameId);
    }

    const { error } = await query;
    if (error) {
      console.error('[SYNC] Failed to deactivate other active games:', error);
    }
  }, [user?.id]);

  const loadTimerState = useCallback((): TimerState | null => {
    try {
      const saved = localStorage.getItem(TIMER_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const loadPitchState = useCallback((teamId?: string): PitchState | null => {
    try {
      if (teamId) {
        const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
        if (teamSaved) return JSON.parse(teamSaved);

        const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
        if (!activeSaved) return null;
        const activeState = JSON.parse(activeSaved) as PitchState & { teamId?: string };
        return activeState.teamId === teamId ? activeState : null;
      }

      const saved = localStorage.getItem(PITCH_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const syncToDatabase = useCallback(async () => {
    if (!user?.id) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);

    const deactivateActiveGame = async () => {
      if (!activeGameIdRef.current) return;

      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', activeGameIdRef.current);

      activeGameIdRef.current = null;
    };

    // If no active game state, deactivate any existing game
    if (!timerState || !pitchState) {
      await deactivateActiveGame();
      return;
    }

    const halfDurationSeconds = timerState.minutesPerHalf * 60;
    const secondsSinceLastUpdate = timerState.lastUpdateTime
      ? Math.max(0, Math.floor((Date.now() - timerState.lastUpdateTime) / 1000))
      : 0;
    const projectedElapsedSeconds = timerState.elapsedSeconds + (timerState.isRunning ? secondsSinceLastUpdate : 0);
    const isFinishedByState = Boolean((timerState as TimerState & { isGameFinished?: boolean }).isGameFinished)
      || (timerState.currentHalf === 2 && projectedElapsedSeconds >= halfDurationSeconds);

    // Never re-sync or resurrect a game after full time
    if (isFinishedByState || !timerState.isRunning || !pitchState.autoSubActive) {
      await deactivateActiveGame();
      return;
    }

    // Skip syncing to active_games for event-group based games
    // Those are synced via useEventGroupSync to the event_groups table
    const isEventGroup = timerState.teamId?.startsWith("event-group-");
    if (isEventGroup) {
      return;
    }

    const gameData = {
      user_id: user.id,
      team_id: timerState.teamId || null,
      timer_state: timerState as unknown as Json,
      pitch_state: pitchState as unknown as Json,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    try {
      if (activeGameIdRef.current) {
        await deactivateOtherActiveGames(activeGameIdRef.current);

        // Update existing game
        const { error } = await supabase
          .from('active_games')
          .update(gameData)
          .eq('id', activeGameIdRef.current);

        if (error) {
          console.error('[SYNC] Failed to update game:', error);
          activeGameIdRef.current = null;
        }
      } else {
        // Reuse the most recent active game for this user and deactivate any extras.
        const { data: existingGames, error: existingError } = await supabase
          .from('active_games')
          .select('id, team_id, updated_at')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (existingError) {
          console.error('[SYNC] Failed to fetch existing active games:', existingError);
        }

        const matchingGame = existingGames?.find((game) => game.team_id === (timerState.teamId || null));
        const fallbackGame = existingGames?.[0];
        const existing = matchingGame || fallbackGame;

        if (existing) {
          activeGameIdRef.current = existing.id;
          await deactivateOtherActiveGames(existing.id);
          await supabase
            .from('active_games')
            .update(gameData)
            .eq('id', existing.id);
        } else {
          const { data: newGame, error } = await supabase
            .from('active_games')
            .insert(gameData)
            .select()
            .single();

          if (error) {
            console.error('[SYNC] Failed to create game:', error);
          } else {
            activeGameIdRef.current = newGame.id;
            await deactivateOtherActiveGames(newGame.id);
            console.log('[SYNC] Created new active game:', newGame.id);
          }
        }
      }
    } catch (err) {
      console.error('[SYNC] Sync error:', err);
    }
  }, [user?.id, loadTimerState, loadPitchState, deactivateOtherActiveGames]);

  const startSync = useCallback(() => {
    if (syncIntervalRef.current) return;
    
    // Sync immediately
    syncToDatabase();
    
    // Then sync every interval
    syncIntervalRef.current = setInterval(syncToDatabase, SYNC_INTERVAL);
    console.log('[SYNC] Started game state sync');
  }, [syncToDatabase]);

  const stopSync = useCallback(async () => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Mark game as inactive
    if (activeGameIdRef.current) {
      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', activeGameIdRef.current);
      activeGameIdRef.current = null;
    }
    console.log('[SYNC] Stopped game state sync');
  }, []);

  // Force sync on demand
  const forceSync = useCallback(() => {
    syncToDatabase();
  }, [syncToDatabase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  return {
    startSync,
    stopSync,
    forceSync,
    isActive: !!activeGameIdRef.current,
  };
}
