/**
 * Global fetch interceptor that retries Supabase data/storage requests once
 * after refreshing the session when they fail with 401 / JWT-expired.
 *
 * Background: on iOS WKWebView and inside iframed previews, the supabase-js
 * `autoRefreshToken` timer can be throttled or its localStorage write can be
 * blocked, so the access token can lapse mid-session. Without this guard the
 * stale token causes RLS-scoped pages (Schedule, Media, Pro checks) to either
 * silently render empty or display a generic "couldn't verify" error.
 *
 * Triggered only for requests to the Supabase REST/storage/functions hosts —
 * never wraps unrelated fetches (auth/token endpoint included so we don't
 * recurse).
 */

import { supabase } from "@/integrations/supabase/client";

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

    let response: Response;
    try {
      response = await origFetch(input, init);
    } catch (err) {
      throw err;
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
