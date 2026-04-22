import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { setSyncStatus } from "./useSyncStatus";
import { buildGameSignature } from "@/lib/gameSyncSignature";
import { recordSyncWrite } from "@/lib/syncWriteRateMonitor";
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

  // Deactivate stale rows ONLY for the same (user, team) combination so a
  // coach running boards for two different teams in parallel tabs / devices
  // doesn't keep flipping each other off. Without the team scope, two
  // simultaneous boards from the same coach would ping-pong every 10s.
  const deactivateOtherGames = useCallback(
    async (teamId: string | null, keepId?: string | null) => {
      if (!user?.id) return;
      let q = supabase
        .from("active_games")
        .update({ is_active: false })
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (teamId) q = q.eq("team_id", teamId);
      else q = q.is("team_id", null);
      if (keepId) q = q.neq("id", keepId);
      await q;
    },
    [user?.id]
  );

  // Cheap signature so we skip the round-trip when nothing material changed.
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
    });
    if (!force && signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    setSyncStatus({ status: "syncing", lastSyncTime: Date.now() });

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
      const teamId = state.teamId || null;

      if (activeGameIdRef.current) {
        await deactivateOtherGames(teamId, activeGameIdRef.current);
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

      // Look up an existing active row that BELONGS to this exact (user, team).
      // The previous fallback ?? existing?.[0] would silently adopt a different
      // team's row and overwrite it — corrupting the other game at scale.
      let q = supabase
        .from("active_games")
        .select("id, team_id, updated_at")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(5);
      q = teamId ? q.eq("team_id", teamId) : q.is("team_id", null);
      const { data: existing } = await q;

      const match = existing?.[0];

      if (match) {
        activeGameIdRef.current = match.id;
        await deactivateOtherGames(teamId, match.id);
        await supabase.from("active_games").update(gameData).eq("id", match.id);
      } else {
        const { data: created, error } = await supabase
          .from("active_games")
          .insert(gameData)
          .select("id")
          .single();
        if (error) {
          // 23505 = unique_violation. The DB now enforces one active row per
          // team via uniq_active_games_team_active, so a race between two
          // coaches starting the same team lands here. Recover by adopting
          // the existing row instead of leaving the board un-synced.
          if ((error as { code?: string }).code === "23505" && teamId) {
            const { data: claimed } = await supabase
              .from("active_games")
              .select("id")
              .eq("team_id", teamId)
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            if (claimed) {
              activeGameIdRef.current = claimed.id;
              await supabase.from("active_games").update(gameData).eq("id", claimed.id);
            } else {
              console.error("[basketball-sync] insert race but no claimed row", error);
            }
          } else {
            console.error("[basketball-sync] insert failed", error);
          }
        } else if (created) {
          activeGameIdRef.current = created.id;
          await deactivateOtherGames(teamId, created.id);
        }
      }
      setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
    } catch (err) {
      console.error("[basketball-sync] sync error", err);
      setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: String(err) });
    }
  }, [user?.id, enabled, state, timerState, deactivateOtherGames]);

  // Keep a ref to the latest syncNow so the interval doesn't tear down +
  // rebuild on every state change (audit fix B10). Previously the 10s
  // throttle never fired because the effect re-ran each tick.
  const syncNowRef = useRef(syncNow);
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    if (!enabled) return;
    // First sync on mount is forced so the spectator sees state immediately.
    syncNowRef.current(true);
    intervalRef.current = setInterval(() => syncNowRef.current(false), SYNC_INTERVAL);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);

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
