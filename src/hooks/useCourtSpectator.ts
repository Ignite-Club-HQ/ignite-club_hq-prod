import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  BasketballBoardState,
  BasketballTimerState,
} from "@/components/basketball/types";
import type {
  NetballBoardState,
  NetballTimerState,
} from "@/components/netball/types";
import type { CourtSpectatorState, SpectatorSport } from "@/components/scoreboard/spectatorTypes";

/**
 * Subscribes to the most-recent active_games row for a team and projects it
 * into a sport-tagged spectator state. Used by the read-only Watch Live page
 * so parents/players can follow along without external inputs.
 *
 * Read access is governed by the existing RLS policy "Team members can view
 * team games" on `active_games` (uses `is_team_member()`), so the only thing
 * we have to do here is fetch + subscribe.
 */
export interface UseCourtSpectatorResult {
  state: CourtSpectatorState | null;
  /** True until the first row (or definitive empty result) lands. */
  isLoading: boolean;
  /** True when no active row exists for the team. */
  noActiveGame: boolean;
  /** Surfaced fetch / subscription error if any. */
  error: string | null;
}

interface ActiveGameRow {
  id: string;
  team_id: string | null;
  pitch_state: Json;
  timer_state: Json;
  updated_at: string;
  is_active: boolean;
}

const projectRow = (row: ActiveGameRow | null): CourtSpectatorState | null => {
  if (!row) return null;
  const pitch = (row.pitch_state ?? {}) as Record<string, unknown>;
  const timer = (row.timer_state ?? {}) as Record<string, unknown>;
  // Sport tag was added when boards started writing — fall back gracefully.
  const sport = (pitch.sport ?? timer.sport ?? null) as SpectatorSport | null;
  if (sport !== "basketball" && sport !== "netball") return null;
  const receivedAt = row.updated_at ? Date.parse(row.updated_at) : Date.now();
  if (sport === "basketball") {
    return {
      sport: "basketball",
      board: pitch as Partial<BasketballBoardState>,
      timer: timer as Partial<BasketballTimerState>,
      receivedAt,
    };
  }
  return {
    sport: "netball",
    board: pitch as Partial<NetballBoardState>,
    timer: timer as Partial<NetballTimerState>,
    receivedAt,
  };
};

export function useCourtSpectator(teamId: string | null | undefined): UseCourtSpectatorResult {
  const [state, setState] = useState<CourtSpectatorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [noActiveGame, setNoActiveGame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  // Initial fetch — most recently updated active row for this team.
  useEffect(() => {
    if (!teamId) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNoActiveGame(false);
    (async () => {
      const { data, error: err } = await supabase
        .from("active_games")
        .select("id, team_id, pitch_state, timer_state, updated_at, is_active")
        .eq("team_id", teamId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setIsLoading(false);
        return;
      }
      if (!data) {
        setNoActiveGame(true);
        setIsLoading(false);
        return;
      }
      setActiveRowId(data.id);
      setState(projectRow(data as ActiveGameRow));
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Realtime subscription on the team's row(s). We listen broadly to all
  // changes for this team_id and re-project on every payload, since the
  // active row id may rotate (e.g. coach restarts a game).
  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`active_games:team:${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "active_games",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as ActiveGameRow | null;
          if (!row) return;
          // Coach ended this game — clear state if it was the one we watched.
          if (!row.is_active) {
            if (activeRowId && row.id === activeRowId) {
              setState(null);
              setNoActiveGame(true);
            }
            return;
          }
          // New active row (or update to the existing one) — adopt + project.
          setActiveRowId(row.id);
          setNoActiveGame(false);
          setState(projectRow(row));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, activeRowId]);

  return { state, isLoading, noActiveGame, error };
}
