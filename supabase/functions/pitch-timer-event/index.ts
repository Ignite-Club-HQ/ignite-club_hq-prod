// Server-anchored pitch timer events. The client never stores elapsed time
// directly — it sends events (start_half, pause, resume, end_half,
// start_half_2, end_game, adjust, set_minutes) and the server stamps them
// against now(). Elapsed is always derived as
//   (paused ? half_paused_at : now()) - half_started_at - accumulated_pause_ms
// so resume-after-lock can never drift or revert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventType =
  | "start_half"
  | "pause"
  | "resume"
  | "end_half"
  | "start_half_2"
  | "end_game"
  | "adjust"
  | "set_minutes"
  | "reset";

interface ServerTimer {
  schema_version: 2;
  current_half: 1 | 2;
  minutes_per_half: number;
  half_started_at: string | null; // ISO
  half_paused_at: string | null;  // ISO
  accumulated_pause_ms: number;   // within current half
  is_running: boolean;
  is_game_finished: boolean;
  half_ended_at: string | null;
  last_event_at: string;          // ISO
}

const nowIso = () => new Date().toISOString();

function deriveElapsedSeconds(t: ServerTimer): number {
  if (!t.half_started_at) return 0;
  const start = new Date(t.half_started_at).getTime();
  const ref = t.half_paused_at ? new Date(t.half_paused_at).getTime() : Date.now();
  const ms = Math.max(0, ref - start - (t.accumulated_pause_ms || 0));
  return Math.min(Math.floor(ms / 1000), (t.minutes_per_half || 0) * 60);
}

function emptyTimer(minutesPerHalf: number): ServerTimer {
  return {
    schema_version: 2,
    current_half: 1,
    minutes_per_half: minutesPerHalf,
    half_started_at: null,
    half_paused_at: null,
    accumulated_pause_ms: 0,
    is_running: false,
    is_game_finished: false,
    half_ended_at: null,
    last_event_at: nowIso(),
  };
}

function applyEvent(prev: ServerTimer, evt: EventType, payload: Record<string, unknown>): ServerTimer {
  const t: ServerTimer = { ...prev, last_event_at: nowIso() };
  switch (evt) {
    case "start_half": {
      // Start (or restart) the current half from 0.
      t.half_started_at = nowIso();
      t.half_paused_at = null;
      t.accumulated_pause_ms = 0;
      t.is_running = true;
      t.is_game_finished = false;
      t.half_ended_at = null;
      return t;
    }
    case "pause": {
      if (!t.is_running || t.half_paused_at) return t;
      t.half_paused_at = nowIso();
      t.is_running = false;
      return t;
    }
    case "resume": {
      if (t.is_running) return t;
      if (t.half_paused_at && t.half_started_at) {
        const pausedFor = Date.now() - new Date(t.half_paused_at).getTime();
        t.accumulated_pause_ms = (t.accumulated_pause_ms || 0) + Math.max(0, pausedFor);
      } else if (!t.half_started_at) {
        // Resume with no prior start = start now.
        t.half_started_at = nowIso();
        t.accumulated_pause_ms = 0;
      }
      t.half_paused_at = null;
      t.is_running = true;
      return t;
    }
    case "end_half": {
      t.is_running = false;
      t.half_paused_at = null;
      t.half_ended_at = nowIso();
      // Don't bump half here — wait for explicit start_half_2 so spectators
      // can show "Half time" cleanly.
      return t;
    }
    case "start_half_2": {
      t.current_half = 2;
      t.half_started_at = nowIso();
      t.half_paused_at = null;
      t.accumulated_pause_ms = 0;
      t.half_ended_at = null;
      t.is_running = true;
      t.is_game_finished = false;
      return t;
    }
    case "end_game": {
      t.is_running = false;
      t.half_paused_at = null;
      t.is_game_finished = true;
      t.half_ended_at = nowIso();
      return t;
    }
    case "adjust": {
      // Admin nudge by N seconds (+/-). Shift half_started_at backwards/forwards.
      const delta = Number(payload.delta_seconds || 0);
      if (!Number.isFinite(delta) || delta === 0 || !t.half_started_at) return t;
      const start = new Date(t.half_started_at).getTime();
      // delta positive = add elapsed = move start earlier.
      t.half_started_at = new Date(start - delta * 1000).toISOString();
      return t;
    }
    case "set_minutes": {
      const m = Math.max(1, Math.min(60, Number(payload.minutes_per_half || 0)));
      if (m) t.minutes_per_half = m;
      return t;
    }
    case "reset": {
      return emptyTimer(t.minutes_per_half);
    }
    default:
      return t;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const teamId: string | null = body.team_id ?? null;
    const event: EventType = body.event;
    const payload: Record<string, unknown> = body.payload || {};
    const initialMinutes = Math.max(1, Math.min(60, Number(body.minutes_per_half || 10)));

    // Optional pitch_state patch from the client. We persist autoSubPlan /
    // autoSubActive / players alongside the timer event so the cron
    // (`check-pending-subs`) and spectators always see an up-to-date plan
    // even if the local `GlobalSubMonitor` write loop hasn't fired yet
    // (e.g. unlinked board, or admin closed the app right after planning).
    // Audit fix #10: cap incoming arrays so a malformed client can't bloat
    // the active_games row (which the cron re-reads every minute).
    const MAX_PLAYERS = 30;
    const MAX_PLAN = 200;
    const incomingAutoSubPlan = Array.isArray(body.auto_sub_plan)
      ? body.auto_sub_plan.slice(0, MAX_PLAN)
      : null;
    const incomingAutoSubActive = typeof body.auto_sub_active === "boolean" ? body.auto_sub_active : null;
    const incomingPlayers = Array.isArray(body.players)
      ? body.players.slice(0, MAX_PLAYERS)
      : null;

    if (!event) {
      return new Response(JSON.stringify({ error: "missing event" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the read-modify-write so we don't fight RLS.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Lookup existing active row for this (team or user).
    let q = admin.from("active_games")
      .select("id, timer_state, pitch_state, user_id, team_id")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);
    q = teamId ? q.eq("team_id", teamId) : q.eq("user_id", user.id).is("team_id", null);
    const { data: existing } = await q.maybeSingle();

    const prev: ServerTimer = existing?.timer_state?.schema_version === 2
      ? existing.timer_state as ServerTimer
      : emptyTimer(initialMinutes);

    const next = applyEvent(prev, event, payload);

    // Merge any incoming pitch_state patch on top of existing pitch_state
    // (so we don't drop fields the client didn't include).
    const basePitchState: Record<string, unknown> =
      (existing?.pitch_state as Record<string, unknown> | null) ?? { sport: "soccer", autoSubActive: true };
    const mergedPitchState: Record<string, unknown> = { ...basePitchState };
    if (incomingAutoSubPlan !== null) mergedPitchState.autoSubPlan = incomingAutoSubPlan;
    if (incomingAutoSubActive !== null) mergedPitchState.autoSubActive = incomingAutoSubActive;
    if (incomingPlayers !== null) mergedPitchState.players = incomingPlayers;

    // Fresh-start events must reset `last_sub_check_time` to 0, otherwise a
    // leftover value from a previous game / half would suppress the very
    // first pending-sub notification of the new half (see check-pending-subs
    // `absoluteSubTime > last_sub_check_time` filter).
    //
    // Audit fix #7 + #8: `adjust` (admin rewinds the clock) and `set_minutes`
    // (changes half length, which redefines the absolute-seconds axis the
    // counter is stored in) must ALSO reset the gate — otherwise either
    // (a) subs that were formerly past `last_sub_check_time` will never
    // re-fire after the rewind, or (b) the counter now points at a wrong
    // game-time after minutes-per-half changes.
    const isFreshStart =
      event === "start_half" ||
      event === "start_half_2" ||
      event === "reset" ||
      event === "adjust" ||
      event === "set_minutes";

    let rowId = existing?.id;
    if (!rowId) {
      // Create a new active_games row so server-side cron / spectators see it.
      const { data: created, error: insErr } = await admin
        .from("active_games")
        .insert({
          user_id: user.id,
          team_id: teamId,
          is_active: true,
          timer_state: next as unknown,
          pitch_state: mergedPitchState as unknown,
          last_sub_check_time: 0,
          updated_at: nowIso(),
        })
        .select("id")
        .single();
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      rowId = created.id;
    } else {
      const updatePayload: Record<string, unknown> = {
        timer_state: next as unknown,
        pitch_state: mergedPitchState as unknown,
        updated_at: nowIso(),
        is_active: !next.is_game_finished,
      };
      if (isFreshStart) updatePayload.last_sub_check_time = 0;
      await admin.from("active_games")
        .update(updatePayload)
        .eq("id", rowId);
    }

    return new Response(JSON.stringify({
      ok: true,
      row_id: rowId,
      timer_state: next,
      elapsed_seconds: deriveElapsedSeconds(next),
      server_now: nowIso(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
