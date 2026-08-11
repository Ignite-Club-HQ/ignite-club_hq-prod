/**
 * Redirect-origin allowlisting for payment Edge Functions.
 *
 * Caller-supplied `successUrl` / `cancelUrl` values are attacker controlled.
 * They must never be forwarded to a payment provider without validation, and
 * we must never synthesise a fallback from the untrusted `Origin` request
 * header.
 *
 * Everything in this module is pure so it can be unit tested from Vitest
 * without a Deno runtime or any network access.
 */

/** Origins that are always approved for Ignite redirects. */
export const DEFAULT_APPROVED_ORIGINS: readonly string[] = [
  "https://igniteclubhq.app",
  "https://www.igniteclubhq.app",
  "https://ignite-club-launchpad.lovable.app",
];

/** Local development origins — only enabled when explicitly opted in. */
export const LOCAL_ORIGINS: readonly string[] = [
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
];

export interface RedirectEnv {
  /** Comma separated extra approved origins (e.g. an approved preview host). */
  APP_ALLOWED_REDIRECT_ORIGINS?: string;
  /** "true" enables the localhost origins above. */
  ALLOW_LOCAL_REDIRECTS?: string;
  /** Canonical application origin used when no caller URL is supplied. */
  APP_PUBLIC_ORIGIN?: string;
}

function normaliseOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // `URL.origin` drops any path/credentials/query and lowercases the host.
  return parsed.origin;
}

/**
 * Build the approved-origin allowlist from configuration. Invalid entries are
 * dropped rather than widening the allowlist.
 */
export function buildApprovedOrigins(env: RedirectEnv = {}): string[] {
  const origins = new Set<string>();

  for (const origin of DEFAULT_APPROVED_ORIGINS) {
    const normalised = normaliseOrigin(origin);
    if (normalised) origins.add(normalised);
  }

  if (env.ALLOW_LOCAL_REDIRECTS === "true") {
    for (const origin of LOCAL_ORIGINS) {
      const normalised = normaliseOrigin(origin);
      if (normalised) origins.add(normalised);
    }
  }

  for (const raw of (env.APP_ALLOWED_REDIRECT_ORIGINS ?? "").split(",")) {
    const normalised = normaliseOrigin(raw);
    if (normalised) origins.add(normalised);
  }

  const configuredPublic = normaliseOrigin(env.APP_PUBLIC_ORIGIN ?? "");
  if (configuredPublic) origins.add(configuredPublic);

  return [...origins];
}

/** The safe origin used when the caller supplies no redirect URL. */
export function resolveApplicationOrigin(env: RedirectEnv = {}): string {
  const configured = normaliseOrigin(env.APP_PUBLIC_ORIGIN ?? "");
  if (configured) return configured;
  return DEFAULT_APPROVED_ORIGINS[0];
}

/**
 * Exact-origin match against the allowlist.
 *
 * Rejects: different domains, subdomain-suffix tricks
 * (`approved.example.evil.test`), credentials in the URL, non-HTTP(S)
 * protocols, protocol-relative URLs, custom schemes and malformed URLs.
 */
export function isApprovedRedirectUrl(
  candidate: unknown,
  approvedOrigins: readonly string[],
): boolean {
  if (typeof candidate !== "string") return false;
  const value = candidate.trim();
  if (!value) return false;
  // Protocol-relative ("//evil.test/x") and scheme-less values never parse
  // to an absolute URL without a base, so `new URL` rejects them for us.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  // Credentials embedded in the URL are always rejected, even on an
  // otherwise-approved host.
  if (parsed.username || parsed.password) return false;
  return approvedOrigins.includes(parsed.origin);
}

/**
 * Resolve a caller-supplied redirect URL.
 *
 * - Absent/empty → the trusted fallback (never the request `Origin` header).
 * - Present and approved → used verbatim (preserving path + query).
 * - Present and not approved → `null`, which callers must treat as a hard
 *   rejection rather than silently substituting the fallback.
 */
export function resolveRedirectUrl(
  candidate: unknown,
  fallbackUrl: string,
  approvedOrigins: readonly string[],
): { ok: true; url: string } | { ok: false; code: "invalid_redirect_url" } {
  if (candidate === undefined || candidate === null || candidate === "") {
    return { ok: true, url: fallbackUrl };
  }
  if (isApprovedRedirectUrl(candidate, approvedOrigins)) {
    return { ok: true, url: (candidate as string).trim() };
  }
  return { ok: false, code: "invalid_redirect_url" };
}
