// Client wrapper for the server-anchored pitch timer.
// The server is the source of truth for elapsed time — clients only render.
// Drift is impossible because elapsed is derived as
//   (paused ? half_paused_at : now()) - half_started_at - accumulated_pause_ms
// Phase 1: helpers only. Phase 2 will wire these into GameTimer / Widget.
import { supabase } from "@/integrations/supabase/client";

export interface ServerTimer {
  schema_version: 2;
  current_half: 1 | 2;
  minutes_per_half: number;
  half_started_at: string | null;
  half_paused_at: string | null;
  accumulated_pause_ms: number;
  is_running: boolean;
  is_game_finished: boolean;
  half_ended_at: string | null;
  last_event_at: string;
}

export type TimerEvent =
  | "start_half"
  | "pause"
  | "resume"
  | "end_half"
  | "start_half_2"
  | "end_game"
  | "adjust"
  | "set_minutes"
  | "reset";

export interface TimerEventResponse {
  ok: true;
  row_id: string;
  timer_state: ServerTimer;
  elapsed_seconds: number;
  server_now: string;
}

export interface TimerReadResponse {
  found: boolean;
  row_id?: string;
  team_id?: string | null;
  timer_state?: ServerTimer;
  pitch_state?: unknown;
  elapsed_seconds?: number;
  server_now: string;
}

/**
 * Compute elapsed seconds from a ServerTimer using a reference timestamp.
 * Pass `serverNowMs` from the most recent read so the value is anchored
 * to server time and immune to device clock skew.
 */
export function deriveElapsedSeconds(
  t: ServerTimer | null | undefined,
  referenceMs: number = Date.now(),
): number {
  if (!t?.half_started_at) return 0;
  const start = new Date(t.half_started_at).getTime();
  const ref = t.half_paused_at ? new Date(t.half_paused_at).getTime() : referenceMs;
  const ms = Math.max(0, ref - start - (t.accumulated_pause_ms || 0));
  return Math.min(Math.floor(ms / 1000), (t.minutes_per_half || 0) * 60);
}

export async function sendTimerEvent(args: {
  teamId: string | null;
  event: TimerEvent;
  minutesPerHalf?: number;
  payload?: Record<string, unknown>;
  /**
   * Optional pitch_state patch persisted server-side alongside the timer
   * event. Use to keep `autoSubPlan` / `players` fresh for the pending-sub
   * cron even when the board hasn't been linked to an event (so
   * `GlobalSubMonitor`'s own DB sync is skipped).
   */
  autoSubPlan?: unknown[];
  autoSubActive?: boolean;
  players?: unknown[];
}): Promise<TimerEventResponse> {
  const { data, error } = await supabase.functions.invoke("pitch-timer-event", {
    body: {
      team_id: args.teamId,
      event: args.event,
      minutes_per_half: args.minutesPerHalf,
      payload: args.payload ?? {},
      ...(args.autoSubPlan !== undefined ? { auto_sub_plan: args.autoSubPlan } : {}),
      ...(args.autoSubActive !== undefined ? { auto_sub_active: args.autoSubActive } : {}),
      ...(args.players !== undefined ? { players: args.players } : {}),
    },
  });
  if (error) throw error;
  return data as TimerEventResponse;
}

export async function readServerTimer(teamId: string | null): Promise<TimerReadResponse> {
  // Skip if user is not authenticated OR the access token is expired —
  // avoids 401 blank-screen reports on /auth, during sign-out, and when
  // a stale session is still in localStorage but auto-refresh hasn't run.
  const empty: TimerReadResponse = { found: false, server_now: new Date().toISOString() };
  let accessToken: string | null = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session?.access_token) return empty;
    const expiresAt = session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    // If the token is expired (or about to be), skip — don't risk a 401.
    if (expiresAt && expiresAt - nowSec <= 5) return empty;
    accessToken = session.access_token;
  } catch {
    return empty;
  }

  const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
  try {
    // Use raw fetch with an explicit Authorization header so we never fall
    // back to the anon key (which is what triggers the 401 -> blank-screen
    // runtime-error report in the Lovable preview).
    const base = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const res = await fetch(`${base}/functions/v1/pitch-timer-read${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
      },
    });
    if (!res.ok) return empty;
    return (await res.json()) as TimerReadResponse;
  } catch {
    return empty;
  }
}

/**
 * Returns the offset (ms) to add to Date.now() to approximate server time.
 * Use the most recent read for skew correction in the visual tick.
 */
export function computeClockSkewMs(serverNowIso: string): number {
  return new Date(serverNowIso).getTime() - Date.now();
}

/**
 * Local snapshot of the *displayed* timer state at the moment a server read
 * resolves. Used by `shouldAcceptServerSnapshot` to detect stale/racing reads
 * that would move an active clock backwards.
 */
export interface LocalTimerSnapshot {
  isRunning: boolean;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isGameFinished: boolean;
}

/**
 * Guard against stale / out-of-order server snapshots overwriting a live
 * timer. Rules (in order):
 *
 *   1. No previous accepted snapshot → accept (first hydrate).
 *   2. Strictly newer `last_event_at` → accept (authoritative newer event).
 *   3. Equal `last_event_at`, and the incoming snapshot doesn't zero out a
 *      locally-advanced clock → accept (idempotent re-read).
 *   4. Otherwise reject. In particular a snapshot with an older or equal
 *      `last_event_at` that would move a running/advanced local clock
 *      backwards to zero is rejected — this is the "stale zero on resume"
 *      failure mode.
 *
 * A legitimate manual reset always propagates because `pitch-timer-event`
 * bumps `last_event_at` at the same time it zeroes the state, so rule (2)
 * matches. Half transitions and `set_minutes` behave the same way.
 */
export function shouldAcceptServerSnapshot(
  prev: Pick<ServerTimer, "last_event_at"> | null | undefined,
  incoming: ServerTimer,
  local?: LocalTimerSnapshot,
): { accept: boolean; reason: string } {
  if (!prev?.last_event_at) return { accept: true, reason: "first-hydrate" };

  const prevMs = new Date(prev.last_event_at).getTime();
  const nextMs = new Date(incoming.last_event_at).getTime();
  const incomingIsZero =
    !incoming.is_running &&
    !incoming.half_started_at &&
    (incoming.current_half ?? 1) === 1 &&
    !incoming.is_game_finished;
  const localAdvanced = !!local && (local.isRunning || local.elapsedSeconds > 0 || local.currentHalf === 2 || local.isGameFinished);

  // Backwards-movement guard: reject any incoming snapshot whose derived
  // elapsed would regress the currently displayed clock in the same half,
  // regardless of `last_event_at`. Legitimate resets / half transitions
  // change `current_half` OR clear `half_started_at` under a newer event
  // timestamp, which is handled explicitly below.
  const REGRESSION_TOLERANCE_SEC = 2;
  if (local && Number.isFinite(nextMs) && Number.isFinite(prevMs)) {
    const incomingElapsed = deriveElapsedSeconds(incoming, nextMs);
    const sameHalf = (incoming.current_half ?? 1) === local.currentHalf;
    const wouldRegress = sameHalf && incomingElapsed + REGRESSION_TOLERANCE_SEC < local.elapsedSeconds;
    // Only enforce when the incoming isn't strictly newer AND either running
    // locally or paused with non-zero elapsed. Newer events (manual reset,
    // half transition) are always authoritative.
    if (wouldRegress && nextMs <= prevMs && localAdvanced) {
      return { accept: false, reason: "would-regress-displayed-elapsed" };
    }
  }

  if (Number.isFinite(nextMs) && Number.isFinite(prevMs)) {
    if (nextMs > prevMs) return { accept: true, reason: "newer-event" };
    if (nextMs === prevMs) {
      if (incomingIsZero && localAdvanced) {
        return { accept: false, reason: "stale-zero-at-equal-timestamp" };
      }
      // At equal timestamps, require materially-equivalent state to accept
      // an idempotent re-read. Divergent half_started_at / current_half /
      // is_running / accumulated_pause_ms with the same `last_event_at`
      // means one of the two snapshots is corrupt or racy — refuse to
      // overwrite the accepted state.
      if (prev && "half_started_at" in (prev as ServerTimer)) {
        const p = prev as ServerTimer;
        const stateMatches =
          p.half_started_at === incoming.half_started_at &&
          p.current_half === incoming.current_half &&
          p.is_running === incoming.is_running &&
          (p.accumulated_pause_ms || 0) === (incoming.accumulated_pause_ms || 0) &&
          p.is_game_finished === incoming.is_game_finished;
        if (!stateMatches) {
          return { accept: false, reason: "divergent-state-at-equal-timestamp" };
        }
      }
      return { accept: true, reason: "idempotent-reread" };
    }
  }

  if (localAdvanced) return { accept: false, reason: "older-event-while-local-advanced" };
  return { accept: false, reason: "older-event" };
}

