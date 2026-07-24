// Outbound communications guard.
//
// Fail-open by default: sends go out unless OUTBOUND_COMMUNICATIONS_ENABLED is
// explicitly set to a falsy value ("false", "0", "no", "off"). This means
// prod (where the var is unset) always sends. Dev sets it to "false" to
// block all outbound email + push from reaching real users.
//
// Usage inside an edge function handler (after the OPTIONS check):
//
//   const blocked = outboundBlockedResponse("send-email");
//   if (blocked) return blocked;
//
export function isOutboundBlocked(): boolean {
  const raw = Deno.env.get("OUTBOUND_COMMUNICATIONS_ENABLED");
  if (raw === undefined || raw === null) return false; // default open
  const v = String(raw).trim().toLowerCase();
  if (v === "" ) return false; // empty → open
  return v === "false" || v === "0" || v === "no" || v === "off";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Returns a 200 Response describing the block when outbound is disabled,
 * otherwise null. Call at the top of the request handler.
 */
export function outboundBlockedResponse(fnName: string): Response | null {
  if (!isOutboundBlocked()) return null;
  console.log(
    `[outbound-guard] Blocked ${fnName}: OUTBOUND_COMMUNICATIONS_ENABLED=false`,
  );
  return new Response(
    JSON.stringify({
      blocked: true,
      reason: "outbound_communications_disabled",
      function: fnName,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
