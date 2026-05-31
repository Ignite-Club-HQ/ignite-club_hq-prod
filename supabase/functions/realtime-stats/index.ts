// Returns Realtime usage stats from the Supabase Management API.
// If SUPABASE_PAT is not configured, returns { supported: false, reason }.
// Caller must be an app_admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- AuthN/AuthZ: must be a signed-in app_admin ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ error: "missing_token" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "unauthenticated" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "app_admin")
      .maybeSingle();
    if (!roleRow) {
      return json({ error: "forbidden" }, 403);
    }

    // --- Management API path ---
    const pat = Deno.env.get("SUPABASE_PAT");
    if (!pat) {
      return json({
        supported: false,
        reason: "SUPABASE_PAT secret not set. Add a Personal Access Token to enable real Realtime metrics.",
      });
    }

    const projectRef = Deno.env.get("SUPABASE_PROJECT_REF")
      ?? (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "");
    if (!projectRef) {
      return json({ supported: false, reason: "Could not derive project ref." });
    }

    // Query Supabase logs for realtime connections in the last 5 minutes.
    // We count distinct connection_id occurrences in realtime_logs.
    const WINDOW_SECONDS = 300;
    const sql = `
      SELECT
        COUNT(DISTINCT m.connection_id) AS connections,
        COUNT(*) AS events
      FROM realtime_logs
      CROSS JOIN UNNEST(metadata) AS m
      WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${WINDOW_SECONDS} SECOND)
    `;

    const resp = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );

    if (!resp.ok) {
      const body = await resp.text();
      return json({
        supported: false,
        reason: `Management API returned ${resp.status}: ${body.slice(0, 200)}`,
      });
    }

    const data = await resp.json();
    const row = data?.result?.[0] ?? {};
    return json({
      supported: true,
      concurrent_connections: Number(row.connections ?? 0),
      window_seconds: WINDOW_SECONDS,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return json({ supported: false, reason: (e as Error).message }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
