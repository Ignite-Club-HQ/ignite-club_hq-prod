import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Spectator hook for the netball + basketball court boards.
 *
 * Polls the `active_games` table for the most recent active row for a given
 * team and sport. The row is published every ~10s by the coach's device via
 * `useBasketballGameSync` / `useNetballGameSync`. We poll a little faster (5s)
 * so the spectator view feels live without thrashing the network.
 *
 * Intentionally NOT realtime-subscribed — the active_games table doesn't have
 * realtime publication wired and polling keeps the surface area small. If the
 * coach's device is offline / between syncs, spectators see the last good
 * snapshot rather than a flashing "no data" state.
 *
 * Returns:
 *  - pitchState / timerState — raw payloads from the sync hooks (caller must
 *    cast to its sport-specific type; both shapes are tagged with `sport:`)
 *  - isLive — true when a fresh active row exists for this team+sport
 *  - lastUpdated — server timestamp of the latest snapshot, for staleness UI
 */
export function useCourtSpectator(args: {
  teamId: string | null | undefined;
  sport: "basketball" | "netball";
  /** Disable polling once the spectator board is closed. */
  enabled?: boolean;
}) {
  const { teamId, sport, enabled = true } = args;

  const query = useQuery({
    queryKey: ["court-spectator-active-game", teamId, sport],
    queryFn: async () => {
      if (!teamId) return null;
      // Pull a few candidates and pick the freshest matching sport — the
      // pitch_state JSON is tagged with `sport: 'basketball' | 'netball'`.
      const { data, error } = await supabase
        .from("active_games")
        .select("id, pitch_state, timer_state, updated_at")
        .eq("team_id", teamId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const match = (data ?? []).find((row) => {
        const ps = row.pitch_state as { sport?: string } | null;
        return ps?.sport === sport;
      });
      return match ?? null;
    },
    enabled: !!teamId && enabled,
    refetchInterval: enabled ? 5000 : false,
    // Spectators don't need cached snapshots persisting across mounts — keep
    // it short so a re-open after a few minutes refetches immediately.
    staleTime: 1000,
  });

  const row = query.data;

  // Re-render once a second so any time-derived UI in the board (e.g. quarter
  // clock displays that read from `lastUpdateTime`) refreshes even when the
  // server payload hasn't changed yet.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled || !row) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled, row]);

  return useMemo(
    () => ({
      pitchState: row?.pitch_state ?? null,
      timerState: row?.timer_state ?? null,
      isLive: !!row,
      lastUpdated: row?.updated_at ?? null,
      isLoading: query.isLoading,
    }),
    [row, query.isLoading]
  );
}
