import { useEffect, useRef, useState } from "react";
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
  board_session_id?: string | null;
}

/**
 * Heuristic sport-detection fallback for legacy rows written before
 * `pitch.sport` / `timer.sport` were stamped. Looks at the player position
 * vocabulary on the board, falling back gracefully for empty rosters.
 */
const detectSport = (
  pitch: Record<string, unknown>,
  timer: Record<string, unknown>
): SpectatorSport | null => {
  const tagged = (pitch.sport ?? timer.sport) as SpectatorSport | undefined;
  if (tagged === "basketball" || tagged === "netball" || tagged === "soccer") return tagged;

  // Field hints — basketball-only / netball-only fields appear on their
  // respective timer states.
  if (typeof timer.timeoutsPerHalf === "number") return "basketball";
  if (timer.centrePass === "home" || timer.centrePass === "away") return "netball";
  if (Array.isArray(timer.centrePassLog)) return "netball";

  // Position vocabulary — netball positions vs basketball positions.
  const players = (pitch.players ?? []) as Array<{ position?: string | null }>;
  const positions = new Set(
    players
      .map((p) => p?.position)
      .filter((v): v is string => typeof v === "string")
  );
  if (
    positions.has("GS") || positions.has("GA") || positions.has("WA") ||
    positions.has("WD") || positions.has("GD") || positions.has("GK")
  ) {
    return "netball";
  }
  if (
    positions.has("PG") || positions.has("SG") || positions.has("SF") ||
    positions.has("PF") || positions.has("C")
  ) {
    return "basketball";
  }
  return null;
};

const projectRow = (row: ActiveGameRow | null): CourtSpectatorState | null => {
  if (!row) return null;
  const pitch = (row.pitch_state ?? {}) as Record<string, unknown>;
  const timer = (row.timer_state ?? {}) as Record<string, unknown>;
  const sport = detectSport(pitch, timer);
  const receivedAt = row.updated_at ? Date.parse(row.updated_at) : Date.now();
  if (sport === "basketball") {
    return {
      sport: "basketball",
      board: pitch as Partial<BasketballBoardState>,
      timer: timer as Partial<BasketballTimerState>,
      receivedAt,
    };
  }
  if (sport === "netball") {
    return {
      sport: "netball",
      board: pitch as Partial<NetballBoardState>,
      timer: timer as Partial<NetballTimerState>,
      receivedAt,
    };
  }
  // Default → soccer. Soccer rows historically don't tag a sport, and the
  // position vocabulary is free-form coordinates rather than NB/BB position
  // codes, so anything that doesn't look like NB/BB is treated as soccer.
  return {
    sport: "soccer",
    board: pitch,
    timer,
    receivedAt,
  };
};

export function useCourtSpectator(teamId: string | null | undefined): UseCourtSpectatorResult {
  const [state, setState] = useState<CourtSpectatorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [noActiveGame, setNoActiveGame] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracked via refs (not state) so the realtime subscription effect doesn't
  // re-run when the active row id rotates — that previously caused a
  // tear-down/re-subscribe loop on every coach update.
  //
  // We lock by `board_session_id` (stable for the lifetime of a single coach's
  // hook mount) so the spectator stays attached to one continuous session even
  // if the underlying `active_games.id` changes (e.g. recovery after a 23505
  // unique-violation race forces the coach to adopt a different row id).
  // `activeRowIdRef` is kept as a fallback for legacy rows still in flight
  // before the board_session_id column existed.
  const activeRowIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

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
    activeRowIdRef.current = null;
    activeSessionIdRef.current = null;
    (async () => {
      const { data, error: err } = await supabase
        .from("active_games")
        .select("id, team_id, pitch_state, timer_state, updated_at, is_active, board_session_id")
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
      const row = data as ActiveGameRow;
      activeRowIdRef.current = row.id;
      activeSessionIdRef.current = row.board_session_id ?? null;
      setState(projectRow(row));
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Realtime subscription — bound to teamId only. The subscription is created
  // once per team and stays alive for as long as the spectator is on the page.
  //
  // Multi-coach safety: at scale, two coaches may run boards for the same team
  // simultaneously (each writes its own active_games row). Without locking,
  // the spectator would flip between coaches' state every 10s as updated_at
  // oscillates. We "stick" to the first active session we see (by
  // board_session_id, falling back to row id for legacy rows) and only switch
  // if that session is deactivated.
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

          const lockedSession = activeSessionIdRef.current;
          const lockedRowId = activeRowIdRef.current;
          const incomingSession = row.board_session_id ?? null;

          // Does this event belong to the session we're locked onto?
          // Prefer board_session_id; fall back to row id when either side is
          // missing (legacy rows or coaches still on an older client).
          const matchesLockedSession = lockedSession
            ? incomingSession === lockedSession
            : lockedRowId
              ? row.id === lockedRowId
              : false;

          // Coach ended this game — clear state if it was the session we
          // watched and let the next active session (if any) take over.
          if (!row.is_active) {
            if (lockedSession || lockedRowId) {
              if (matchesLockedSession) {
                setState(null);
                setNoActiveGame(true);
                activeRowIdRef.current = null;
                activeSessionIdRef.current = null;
              }
            }
            return;
          }

          // If we're already locked onto a different active session, ignore
          // the other coach's writes — switching mid-game corrupts the
          // spectator view. The locked session releases on its own deactivate
          // above.
          if ((lockedSession || lockedRowId) && !matchesLockedSession) {
            return;
          }

          // New active session (or update to the session we already watch) —
          // adopt + project. Refresh both refs so future events match
          // regardless of which identifier is populated on the payload.
          activeRowIdRef.current = row.id;
          activeSessionIdRef.current = incomingSession;
          setNoActiveGame(false);
          setState(projectRow(row));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId]);

  return { state, isLoading, noActiveGame, error };
}
