/**
 * Authorises internal/scheduled callers of cron-style Edge Functions.
 *
 * PROD hotfix (2026-07-31), ported here so promotion never reverts it.
 *
 * pg_cron jobs now authenticate with a service-role bearer token
 * (`public.internal_service_role_key()`), while some legacy schedules and
 * manual invocations still send `x-cron-secret: <CRON_SECRET>`. Accept both:
 *
 *  1. `x-cron-secret` matching the `CRON_SECRET` env secret.
 *  2. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (exact match).
 *  3. Fallback for opaque/rotated keys: probe `/auth/v1/admin/users` with the
 *     presented token. Only a service-role-privileged key gets 200. The
 *     `apikey` header is sent only for `sb_`-prefixed opaque keys, since legacy
 *     JWT keys are accepted as bearer alone.
 *
 * Never returns partial credit — the caller either is internal or is rejected.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthorizedCronCaller(req: Request): Promise<boolean> {
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedCronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && expectedCronSecret && timingSafeEqual(cronSecret, expectedCronSecret)) {
    return true;
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && timingSafeEqual(token, serviceKey)) return true;

  // Also accept the cron secret presented as a bearer token (legacy schedules).
  if (expectedCronSecret && timingSafeEqual(token, expectedCronSecret)) return true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return false;

  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (token.startsWith("sb_")) headers["apikey"] = token;

    const probe = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users?page=1&per_page=1`, {
      method: "GET",
      headers,
    });
    // Drain the body so Deno does not leak the connection.
    await probe.body?.cancel();
    return probe.status === 200;
  } catch (err) {
    console.error("[cron-auth] privilege probe failed:", err);
    return false;
  }
}
