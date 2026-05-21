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
  // Skip if user is not authenticated — avoids 401 blank-screen on /auth and during sign-out.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    return { found: false, server_now: new Date().toISOString() } as TimerReadResponse;
  }
  const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
  try {
    const { data, error } = await supabase.functions.invoke(`pitch-timer-read${qs}`, {
      method: "GET",
    });
    if (error) {
      // Silently degrade — timer is non-critical and 401s during token refresh
      // would otherwise blank the screen.
      return { found: false, server_now: new Date().toISOString() } as TimerReadResponse;
    }
    return data as TimerReadResponse;
  } catch {
    return { found: false, server_now: new Date().toISOString() } as TimerReadResponse;
  }
}

/**
 * Returns the offset (ms) to add to Date.now() to approximate server time.
 * Use the most recent read for skew correction in the visual tick.
 */
export function computeClockSkewMs(serverNowIso: string): number {
  return new Date(serverNowIso).getTime() - Date.now();
}
