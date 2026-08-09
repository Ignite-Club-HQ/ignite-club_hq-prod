/**
 * Storage helpers for the invite → auth handoff.
 *
 * Some Android/iOS webviews (and privacy-restricted browser contexts) throw on
 * `sessionStorage` access. The invite "Create Account to Join" button used to
 * write three keys unguarded, so a throw meant the follow-up `navigate("/auth")`
 * never ran and the button appeared to do nothing. These helpers never throw and
 * the auth destination also carries the redirect in the URL as a fallback.
 */

export const AUTH_REDIRECT_PARAM = "redirect";

export function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSessionSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/** Build the `/auth` destination, carrying the post-auth path in the URL too. */
export function buildAuthPathWithRedirect(redirectPath: string): string {
  if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return "/auth";
  }
  return `/auth?${AUTH_REDIRECT_PARAM}=${encodeURIComponent(redirectPath)}`;
}

/** Read the URL-carried redirect fallback from a search string. */
export function readRedirectParam(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get(AUTH_REDIRECT_PARAM);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
