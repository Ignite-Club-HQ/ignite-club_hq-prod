import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// System user used as message author for prompt cards.
const IGNITE_SUPPORT_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Hourly cron: scan team game / mini-league events that ended between
 * 2 and 24 hours ago and post a "Got photos from today?" prompt to the
 * team chat. The RPC is idempotent — it short-circuits if a prompt for
 * the same (team, event) already exists in the last 24h or if any photos
 * have already been uploaded for the event — so widening the scan window
 * is safe and lets us recover from any missed/timed-out hourly run.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const now = new Date();
    // Eligibility: effective end timestamp must be between 24h and 2h ago.
    // The 2h floor lets late additions / score updates settle before nudging.
    const lowerBound = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const upperBound = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    // Pull a generous superset by start_time, then filter by computed end below.
    // Cap to 500 to bound a single cron's work; idempotent dedupe handles repeats.
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, team_id, end_time, start_time, type, opponent, is_cancelled")
      .in("type", ["game", "mini_league"])
      .eq("is_cancelled", false)
      .not("team_id", "is", null)
      .gte("start_time", new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString())
      .lte("start_time", upperBound)
      .limit(500);

    if (eventsError) {
      console.error("[post-game-prompts] events query failed", eventsError);
      return new Response(JSON.stringify({ error: eventsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let posted = 0;
    let skipped = 0;
    let errors = 0;

    for (const ev of events ?? []) {
      // Compute effective end timestamp.
      const endTs = ev.end_time
        ? new Date(ev.end_time as string)
        : new Date(new Date(ev.start_time as string).getTime() + 90 * 60 * 1000);

      const endIso = endTs.toISOString();
      if (endIso < lowerBound || endIso > upperBound) {
        skipped++;
        continue;
      }

      const { data, error } = await supabase.rpc("post_team_gallery_prompt", {
        _team_id: ev.team_id,
        _event_id: ev.id,
        _system_user_id: IGNITE_SUPPORT_USER_ID,
      });

      if (error) {
        console.error("[post-game-prompts] RPC failed for event", ev.id, error);
        errors++;
        continue;
      }
      if (data) {
        posted++;
      } else {
        skipped++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: events?.length ?? 0,
        posted,
        skipped,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[post-game-prompts] uncaught", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
