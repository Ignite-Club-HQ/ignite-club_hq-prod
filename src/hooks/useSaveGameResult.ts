import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { SummaryPlayerStat, PerQuarterScore } from "@/components/scoreboard/GameSummaryDialog";

/**
 * Cross-sport hook for persisting a completed game to `game_results`.
 * Designed for basketball + netball boards. Soccer keeps its own
 * `game_summaries` flow.
 *
 * Behaviour:
 * - Uses upsert on `event_id` so re-finishing the same event won't duplicate.
 * - Falls back to a no-op if the user lacks admin/coach role (RLS rejects).
 * - Surfaces a toast on first save only — silent for re-saves so timer ticks
 *   don't spam the coach during a finished period.
 */
export interface SaveGameResultInput {
  teamId: string;
  eventId?: string | null;
  sport: "basketball" | "netball";
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  perQuarter: PerQuarterScore[];
  players: SummaryPlayerStat[];
  mvpPlayerId?: string | null;
}

export function useSaveGameResult() {
  const { toast } = useToast();
  const savedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const save = useCallback(
    async (input: SaveGameResultInput, opts?: { silent?: boolean }) => {
      // De-dupe within a session: don't re-POST the same finished game.
      const key = `${input.teamId}:${input.eventId ?? "no-event"}:${input.sport}`;
      if (savedKeyRef.current === key || inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return;

        const mvp = input.mvpPlayerId
          ? input.players.find((p) => p.id === input.mvpPlayerId)
          : null;

        const payload = {
          team_id: input.teamId,
          event_id: input.eventId ?? null,
          sport: input.sport,
          home_label: input.homeLabel,
          away_label: input.awayLabel,
          home_score: input.homeScore,
          away_score: input.awayScore,
          period_scores: input.perQuarter as any,
          player_stats: input.players as any,
          mvp_player_id: input.mvpPlayerId ?? null,
          mvp_player_name: mvp?.name ?? null,
          saved_by: uid,
        };

        // If we have an event_id, prefer upsert to keep one row per event.
        const query = input.eventId
          ? supabase
              .from("game_results")
              .upsert(payload, { onConflict: "event_id" })
          : supabase.from("game_results").insert(payload);

        const { error } = await query;
        if (error) {
          // RLS rejection is expected for non-admins — stay quiet.
          if (!/row-level security/i.test(error.message)) {
            // eslint-disable-next-line no-console
            console.warn("[useSaveGameResult] insert failed", error);
          }
          return;
        }

        savedKeyRef.current = key;
        if (!opts?.silent) {
          toast({
            title: "Game saved",
            description: "Available in History on the team page.",
          });
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [toast]
  );

  return { save };
}
