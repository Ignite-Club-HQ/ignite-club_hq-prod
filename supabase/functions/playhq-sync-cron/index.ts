// Periodic PlayHQ resync.
// Finds every competition with source='playhq' and re-invokes playhq-sync for it.
// Triggered by pg_cron (see migration scheduling this every 30 minutes).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: comps, error } = await supabase
    .from("competitions")
    .select("id, external_id, external_tenant, organizer_club_id, name, sport, season")
    .eq("source", "playhq")
    .eq("status", "active")
    .not("external_id", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const c of comps ?? []) {
    if (!c.external_id || !c.external_tenant || !c.organizer_club_id) {
      results.push({ id: c.id, ok: false, error: "missing playhq linkage" });
      continue;
    }
    try {
      const { data, error: invErr } = await supabase.functions.invoke("playhq-sync", {
        body: {
          grade_id: c.external_id,
          tenant: c.external_tenant,
          organizer_club_id: c.organizer_club_id,
          competition_name: c.name,
          sport: c.sport,
          season: c.season,
        },
      });
      if (invErr) throw invErr;
      results.push({ id: c.id, ok: data?.ok !== false });
    } catch (err) {
      results.push({ id: c.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Response(JSON.stringify({ ran: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
