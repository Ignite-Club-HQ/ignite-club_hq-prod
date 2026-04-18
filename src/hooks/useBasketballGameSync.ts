import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { setSyncStatus } from "./useSyncStatus";
import type { Json } from "@/integrations/supabase/types";
import type {
  BasketballBoardState,
  BasketballTimerState,
} from "@/components/basketball/types";

const SYNC_INTERVAL = 10000;

/**
 * Syncs basketball game state to the active_games table so:
 *  - Cross-device coaches see the same board
 *  - The Subs Manager duty role can read live state
 *  - Server-side push notifications can plug in later
 *
 * Reuses the same active_games row schema as soccer/netball,
 * tagging the payload with `sport: 'basketball'` so consumers can branch.
 */
export function useBasketballGameSync(
  state: BasketballBoardState | null,
  timerState: BasketballTimerState | null,
  enabled: boolean
) {
  const { user } = useAuth();
  const activeGameIdRef = useRef<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const deactivateOtherGames = useCallback(
    async (keepId?: string | null) => {
      if (!user?.id) return;
      let q = supabase
        .from("active_games")
        .update({ is_active: false })
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (keepId) q = q.neq("id", keepId);
      await q;
    },
    [user?.id]
  );

  const syncNow = useCallback(async () => {
    if (!user?.id || !enabled || !state || !timerState) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const isFinished = !!timerState.isGameFinished;
    if (isFinished) {
      if (activeGameIdRef.current) {
        await supabase
          .from("active_games")
          .update({ is_active: false })
          .eq("id", activeGameIdRef.current);
        activeGameIdRef.current = null;
      }
      return;
    }

    const pitchPayload: Json = {
      sport: "basketball",
      players: state.players,
      currentQuarter: state.currentQuarter,
      rotationMode: state.rotationMode,
      rotationIntervalMinutes: state.rotationIntervalMinutes,
      autoSubPlan: state.autoSubPlan,
      autoSubActive: state.autoSubActive,
      autoSubPaused: state.autoSubPaused,
      quarterLineups: state.quarterLineups,
      validationMode: state.validationMode,
    } as unknown as Json;

    const timerPayload: Json = {
      sport: "basketball",
      ...timerState,
    } as unknown as Json;

    const gameData = {
      user_id: user.id,
      team_id: state.teamId || null,
      timer_state: timerPayload,
      pitch_state: pitchPayload,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    try {
      if (activeGameIdRef.current) {
        await deactivateOtherGames(activeGameIdRef.current);
        const { error } = await supabase
          .from("active_games")
          .update(gameData)
          .eq("id", activeGameIdRef.current);
        if (error) {
          console.error("[basketball-sync] update failed", error);
          activeGameIdRef.current = null;
        }
        return;
      }

      const { data: existing } = await supabase
        .from("active_games")
        .select("id, team_id, updated_at")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(20);

      const match =
        existing?.find((g) => g.team_id === (state.teamId || null)) ?? existing?.[0];

      if (match) {
        activeGameIdRef.current = match.id;
        await deactivateOtherGames(match.id);
        await supabase.from("active_games").update(gameData).eq("id", match.id);
      } else {
        const { data: created, error } = await supabase
          .from("active_games")
          .insert(gameData)
          .select("id")
          .single();
        if (error) {
          console.error("[basketball-sync] insert failed", error);
        } else if (created) {
          activeGameIdRef.current = created.id;
          await deactivateOtherGames(created.id);
        }
      }
    } catch (err) {
      console.error("[basketball-sync] sync error", err);
    }
  }, [user?.id, enabled, state, timerState, deactivateOtherGames]);

  useEffect(() => {
    if (!enabled) return;
    syncNow();
    intervalRef.current = setInterval(syncNow, SYNC_INTERVAL);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, syncNow]);

  useEffect(() => {
    return () => {
      const id = activeGameIdRef.current;
      if (id) {
        supabase
          .from("active_games")
          .update({ is_active: false })
          .eq("id", id)
          .then(() => {});
      }
    };
  }, []);

  return { forceSync: syncNow };
}
