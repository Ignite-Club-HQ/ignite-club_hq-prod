import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { setSyncStatus } from "./useSyncStatus";
import { buildGameSignature } from "@/lib/gameSyncSignature";
import type { Json } from "@/integrations/supabase/types";
import type { NetballBoardState, NetballTimerState } from "@/components/netball/types";

const SYNC_INTERVAL = 10000;

/**
 * Syncs netball game state to the active_games table so:
 *  - Cross-device coaches see the same board
 *  - The Subs Manager duty role can read the live state
 *  - Server-side push notifications can be added later
 *
 * Reuses the same active_games row schema as the soccer pitch board,
 * tagging the payload with `sport: 'netball'` so consumers can branch.
 */
export function useNetballGameSync(
  state: NetballBoardState | null,
  timerState: NetballTimerState | null,
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

  // Cheap signature so we skip writes when nothing material changed.
  const lastSignatureRef = useRef<string>("");
  const syncNow = useCallback(async (force = false) => {
    if (!user?.id || !enabled || !state || !timerState) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const signature = buildGameSignature({
      players: state.players,
      currentQuarter: state.currentQuarter,
      rotationMode: state.rotationMode,
      validationMode: state.validationMode,
      elapsedSeconds: timerState.elapsedSeconds,
      isRunning: timerState.isRunning,
      isGameFinished: timerState.isGameFinished,
      homeScore: timerState.homeScore,
      awayScore: timerState.awayScore,
      scoreLogLength: timerState.scoreLog?.length,
      subLogLength: timerState.subLog?.length,
      centrePass: timerState.centrePass,
    });
    if (!force && signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    setSyncStatus({ status: "syncing", lastSyncTime: Date.now() });

    const isFinished = !!timerState.isGameFinished;
    if (isFinished) {
      // Game over → mark inactive, stop syncing.
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
      sport: "netball",
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
      sport: "netball",
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
          console.error("[netball-sync] update failed", error);
          activeGameIdRef.current = null;
        }
        return;
      }

      // Find or create
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
          console.error("[netball-sync] insert failed", error);
        } else if (created) {
          activeGameIdRef.current = created.id;
          await deactivateOtherGames(created.id);
        }
      }
      setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
    } catch (err) {
      console.error("[netball-sync] sync error", err);
      setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: String(err) });
    }
  }, [user?.id, enabled, state, timerState, deactivateOtherGames]);

  // Keep a ref to the latest syncNow so the interval doesn't tear down +
  // rebuild on every state change (audit fix N10). Previously the 10s
  // throttle never fired because the effect re-ran each tick.
  const syncNowRef = useRef(syncNow);
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    if (!enabled) return;
    // First sync forced so spectators see state immediately.
    syncNowRef.current(true);
    intervalRef.current = setInterval(() => syncNowRef.current(false), SYNC_INTERVAL);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);

  // On unmount, deactivate the row so stale games don't linger.
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

  return { forceSync: () => syncNow(true) };
}
