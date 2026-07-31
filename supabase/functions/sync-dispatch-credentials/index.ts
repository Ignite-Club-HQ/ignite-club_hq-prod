/**
 * Repairs the Vault credentials that database triggers / cron jobs use to call
 * Edge Functions.
 *
 * The runtime service-role key is authoritative (injected by the platform), so
 * this function copies it — plus the correct functions base URL — into Vault
 * via `public.set_internal_dispatch_credentials`. No secret ever leaves the
 * server or appears in a response body.
 *
 * Callers: internal service-role, or a signed-in `app_admin`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRoleOrAppAdmin, jsonResponse } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireServiceRoleOrAppAdmin(req, corsHeaders);
  if ("response" in auth) return auth.response;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[sync-dispatch-credentials] missing runtime env");
    return jsonResponse({ error: "Server misconfigured" }, 500, corsHeaders);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");

  const { data, error } = await admin.rpc("set_internal_dispatch_credentials", {
    _service_role_key: SERVICE_KEY,
    _functions_base_url: baseUrl,
  });

  if (error) {
    console.error("[sync-dispatch-credentials] vault update failed:", error.message);
    return jsonResponse({ error: "Vault update failed" }, 500, corsHeaders);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  console.log("[sync-dispatch-credentials] vault refreshed", {
    key_matches: result.key_matches,
    base_url: result.base_url,
  });

  return jsonResponse(
    {
      ok: true,
      key_matches: result.key_matches === true,
      base_url: result.base_url ?? null,
    },
    200,
    corsHeaders,
  );
});
