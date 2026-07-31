/**
 * Caller authentication helpers for Edge Functions.
 *
 * Every function deployed with `verify_jwt = false` must independently
 * authenticate its caller BEFORE doing any privileged work (creating a
 * service-role client, reading payloads, querying, mutating, or sending
 * email/push).
 *
 * Three boundaries are supported:
 *
 *  - `requireServiceRoleAuth`  (in `./internal-auth.ts`)
 *      Internal service-to-service, database trigger and cron callers that
 *      present `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 *
 *  - `authenticateUser`
 *      End-user callers from the app. Validates the bearer token with
 *      `auth.getUser()` against the anon client, so an anon/publishable key
 *      presented as a bearer token is rejected.
 *
 *  - `requireServiceRoleOrAppAdmin`
 *      Functions that are both cron-driven and manually runnable from the
 *      app-admin UI.
 *
 * Failure modes are fail-closed: missing configuration denies access, it never
 * disables authentication. Responses never leak tokens, provider errors or
 * database errors.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRoleAuth } from "./internal-auth.ts";

export { requireServiceRoleAuth };

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function unauthorized(corsHeaders: Record<string, string>): Response {
  return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
}

export function forbidden(corsHeaders: Record<string, string>): Response {
  return jsonResponse({ error: "Forbidden" }, 403, corsHeaders);
}

/** Extract a bearer token, or null when absent/malformed. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/** True when the presented bearer token is exactly the service-role key. */
export function isServiceRoleCaller(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!expected) return false;
  const token = bearerToken(req);
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
  token: string;
}

/**
 * Validate an end-user bearer token. Returns the authenticated identity, or a
 * 401 Response. Never accepts the anon key (it has no `sub`).
 */
export async function authenticateUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ user: AuthenticatedUser } | { response: Response }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    // Missing configuration denies access; it must never disable auth.
    return { response: jsonResponse({ error: "Server misconfigured" }, 500, corsHeaders) };
  }

  const token = bearerToken(req);
  if (!token) return { response: unauthorized(corsHeaders) };

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) return { response: unauthorized(corsHeaders) };
    return {
      user: { userId: data.user.id, email: data.user.email ?? null, token },
    };
  } catch (_e) {
    return { response: unauthorized(corsHeaders) };
  }
}

/** Service-role admin client. Only construct after authentication succeeds. */
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export type CallerMode = "service_role" | "app_admin";

/**
 * Accept either an internal service-role caller (cron / DB webhook / another
 * Edge Function) or an authenticated user holding the `app_admin` role.
 *
 * Role lookup errors are NOT treated as denial-by-default-success; they return
 * a retriable 503 so a transient database failure can never be mistaken for
 * either authorization or a real "not an admin" answer.
 */
export async function requireServiceRoleOrAppAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ mode: CallerMode; userId?: string } | { response: Response }> {
  if (isServiceRoleCaller(req)) return { mode: "service_role" };

  const auth = await authenticateUser(req, corsHeaders);
  if ("response" in auth) return auth;

  let isAdmin = false;
  try {
    const admin = serviceClient();
    const { data, error } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.userId)
      .eq("role", "app_admin")
      .limit(1);
    if (error) {
      console.error("[auth] role lookup failed");
      return {
        response: jsonResponse(
          { error: "Authorization check unavailable" },
          503,
          corsHeaders,
        ),
      };
    }
    isAdmin = !!data && data.length > 0;
  } catch (_e) {
    console.error("[auth] role lookup threw");
    return {
      response: jsonResponse(
        { error: "Authorization check unavailable" },
        503,
        corsHeaders,
      ),
    };
  }

  if (!isAdmin) return { response: forbidden(corsHeaders) };
  return { mode: "app_admin", userId: auth.user.userId };
}
