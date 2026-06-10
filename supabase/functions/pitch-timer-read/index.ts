// Reads the server-anchored timer for a given team (or the caller's
// personal/null-team row) and returns elapsed_seconds derived from now().
// Used on mount, on resume, on visibilitychange, and by spectators.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ServerTimer {
  schema_version: 2;
  current_half: number;
  minutes_per_half: number;
  half_started_at: string | null;
  half_paused_at: string | null;
  accumulated_pause_ms: number;
  is_running: boolean;
  is_game_finished: boolean;
  half_ended_at: string | null;
  last_event_at: string;
}

function deriveElapsedSeconds(t: ServerTimer): number {
  if (!t?.half_started_at) return 0;
  const start = new Date(t.half_started_at).getTime();
  const ref = t.half_paused_at ? new Date(t.half_paused_at).getTime() : Date.now();
  const ms = Math.max(0, ref - start - (t.accumulated_pause_ms || 0));
  return Math.min(Math.floor(ms / 1000), (t.minutes_per_half || 0) * 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    const emptyOk = () => new Response(
      JSON.stringify({ found: false, server_now: new Date().toISOString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
    if (!authHeader) return emptyOk();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return emptyOk();

    const url = new URL(req.url);
    const teamId = url.searchParams.get("team_id");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let q = admin.from("active_games")
      .select("id, timer_state, pitch_state, team_id, user_id, updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);
    q = teamId ? q.eq("team_id", teamId) : q.eq("user_id", user.id).is("team_id", null);
    const { data: row } = await q.maybeSingle();

    if (!row) {
      return new Response(JSON.stringify({
        found: false, server_now: new Date().toISOString(),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const t = row.timer_state as ServerTimer;
    const elapsed = t?.schema_version === 2 ? deriveElapsedSeconds(t) : 0;

    return new Response(JSON.stringify({
      found: true,
      row_id: row.id,
      team_id: row.team_id,
      timer_state: t,
      pitch_state: row.pitch_state,
      elapsed_seconds: elapsed,
      server_now: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
