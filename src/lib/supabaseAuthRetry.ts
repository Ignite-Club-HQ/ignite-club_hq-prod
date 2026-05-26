/**
 * Global fetch interceptor for Supabase requests.
 *
 * Two concerns, one wrapper:
 *
 * 1. AUTH RETRY — retries Supabase data/storage requests once after refreshing
 *    the session when they fail with 401 / JWT-expired. On iOS WKWebView and
 *    inside iframed previews, the supabase-js `autoRefreshToken` timer can be
 *    throttled or its localStorage write can be blocked, so the access token
 *    can lapse mid-session. Without this guard the stale token causes RLS-
 *    scoped pages (Schedule, Media, Pro checks) to either silently render
 *    empty or display a generic "couldn't verify" error.
 *
 * 2. READ TIMEOUT — aborts PostgREST GETs that hang past REST_GET_TIMEOUT_MS
 *    so a dead socket on flaky mobile networks fails fast (and React Query
 *    can retry via cache fallback) instead of stalling for ~60s until the
 *    browser's own timeout kicks in. ONLY applied to PostgREST GETs:
 *    - storage uploads, edge functions, mutations, and auth endpoints are
 *      left untouched so we never abort a slow upload or long-running call.
 *
 * Triggered only for requests to the Supabase REST/storage/functions hosts —
 * never wraps unrelated fetches (auth/token endpoint included so we don't
 * recurse).
 */

const REST_GET_TIMEOUT_MS = 15_000;


import { supabase } from "@/integrations/supabase/client";
import { maybeLogSlowFetch } from "@/lib/clientPerfLog";

let installed = false;

export function installSupabaseAuthRetry() {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl) return;

  const origFetch = window.fetch.bind(window);
  installed = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    try {
      url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url;
    } catch {
      return origFetch(input, init);
    }

    const isSupabase = url.startsWith(supabaseUrl);
    // Skip the auth endpoints themselves to avoid recursion when refreshing.
    const isAuthEndpoint = isSupabase && url.includes("/auth/v1/");

    if (!isSupabase || isAuthEndpoint) {
      return origFetch(input, init);
    }

    // --- READ TIMEOUT ---
    // Apply an abort timeout to PostgREST GETs only. We never want to abort
    // storage uploads, edge function calls (some are intentionally long-
    // running), or write/RPC requests where retrying mid-flight could
    // duplicate side effects.
    const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    const isRestGet = method === "GET" && url.includes("/rest/v1/");

    let timeoutInit = init;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (isRestGet) {
      const controller = new AbortController();
      // If caller already passed a signal, chain it so their abort still works.
      const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      timeoutId = setTimeout(() => {
        try { controller.abort(); } catch { /* ignore */ }
      }, REST_GET_TIMEOUT_MS);
      timeoutInit = { ...(init || {}), signal: controller.signal };
    }

    let response: Response;
    const startedAt = isRestGet ? performance.now() : 0;
    try {
      response = await origFetch(input, timeoutInit);
    } catch (err) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (isRestGet) {
        const aborted = (err as any)?.name === "AbortError";
        maybeLogSlowFetch({ url, durationMs: performance.now() - startedAt, status: null, aborted });
      }
      throw err;
    }
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (isRestGet) {
      maybeLogSlowFetch({ url, durationMs: performance.now() - startedAt, status: response.status, aborted: false });
    }

    // Only retry once on auth-shaped failures.
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    // Confirm it's an auth failure (PostgREST returns 403 for plenty of
    // legitimate RLS denials we should NOT retry). Inspect a clone so the
    // caller still gets the original body if we end up returning it.
    let isAuthShaped = response.status === 401;
    if (response.status === 403) {

      try {
        const clone = response.clone();
        const text = await clone.text();
        const lower = text.toLowerCase();
        if (
          lower.includes("jwt") ||
          lower.includes("invalid token") ||
          lower.includes("token is expired") ||
          lower.includes("pgrst301")
        ) {
          isAuthShaped = true;
        }
      } catch {
        // ignore
      }
    }
    if (!isAuthShaped) return response;

    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) return response;

      // Rebuild the request with the fresh token. Supabase-js sets the
      // Authorization header on its own internal fetch — for storage/PostgREST
      // those calls go through us. Replace any Authorization header that
      // matches the old access token.
      const newToken = data.session.access_token;
      const newHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const existingAuth = newHeaders.get("authorization");
      if (existingAuth && /^bearer\s+/i.test(existingAuth)) {
        newHeaders.set("authorization", `Bearer ${newToken}`);
      }

      const retryInit: RequestInit = { ...(init || {}), headers: newHeaders };
      return await origFetch(typeof input === "string" || input instanceof URL ? input : input.url, retryInit);
    } catch {
      return response;
    }
  };
}
