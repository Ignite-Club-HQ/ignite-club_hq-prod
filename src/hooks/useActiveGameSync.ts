import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { Json } from "@/integrations/supabase/types";

const SYNC_INTERVAL = 10000; // Sync every 10 seconds
const TIMER_STATE_KEY = "pitch-board-timer-state";
const PITCH_STATE_KEY = "ignite-pitch-board-state";

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

  const loadTimerState = useCallback((): TimerState | null => {
    try {
      const saved = localStorage.getItem(TIMER_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const loadPitchState = useCallback((): PitchState | null => {
    try {
      const saved = localStorage.getItem(PITCH_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const syncToDatabase = useCallback(async () => {
    if (!user?.id) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState();

    // If no active game state, deactivate any existing game
    if (!timerState || !pitchState) {
      if (activeGameIdRef.current) {
        await supabase
          .from('active_games')
          .update({ is_active: false })
          .eq('id', activeGameIdRef.current);
        activeGameIdRef.current = null;
      }
      return;
    }

    // Only sync if timer is running and auto-sub is active
    if (!timerState.isRunning || !pitchState.autoSubActive) {
      if (activeGameIdRef.current) {
        await supabase
          .from('active_games')
          .update({ is_active: false })
          .eq('id', activeGameIdRef.current);
        activeGameIdRef.current = null;
      }
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
        // Create new game or find existing active one
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
            console.log('[SYNC] Created new active game:', newGame.id);
          }
        }
      }
    } catch (err) {
      console.error('[SYNC] Sync error:', err);
    }
  }, [user?.id, loadTimerState, loadPitchState]);

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
