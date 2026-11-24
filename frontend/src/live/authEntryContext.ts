import { getBackendRoutingConfig, type BackendProvider } from "./backendRouting";
import { isIcpProviderMounted, setAuthMethodChoice } from "./authBackendMode";
import { readAuthIntent } from "@/lib/authRedirectStorage";
import { readEmailSignupInviteToken } from "@/lib/emailSignupPolicy";

export type AuthEntryContext = { method: BackendProvider | null; error: string | null };
let entry: { key: string; result: AuthEntryContext } | null = null;
let pending: { key: string; promise: Promise<AuthEntryContext> } | null = null;

function validPreviewClub(row: unknown, kind: number, now: number): string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const fields = row as Record<string, unknown>;
  if (typeof fields.club_id !== "string" || !fields.club_id.trim()) return null;
  if (kind === 0) {
    // Older public RPCs intentionally omit invited_user_id.
    if (fields.status !== "pending" || fields.invited_user_id != null) return null;
  } else {
    if (fields.expires_at != null && (typeof fields.expires_at !== "string" || !(Date.parse(fields.expires_at) > now))) return null;
    const count = fields.uses_count;
    const max = fields.max_uses;
    if (count != null && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) return null;
    if (max != null && (typeof max !== "number" || !Number.isSafeInteger(max) || max <= 0
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count >= max)) return null;
  }
  return fields.club_id.toLowerCase();
}
export function authEntryKey(): string {
  return `${window.location.pathname}${window.location.search}`;
}
export function readAuthEntryContext(): AuthEntryContext | null {
  return entry?.key === authEntryKey() ? entry.result : null;
}
export function hasAuthEntryIntent(): boolean {
  return readAuthIntent(window.location.search).next === "/clubs/new"
    || Boolean(readEmailSignupInviteToken(window.location.search));
}

/** A read-only preview chooses presentation, never creates or redeems an account. */
export async function prepareAuthEntryContext(): Promise<AuthEntryContext> {
  const key = authEntryKey();
  if (entry?.key === key && !entry.result.error) return entry.result;
  if (pending?.key === key) return pending.promise;
  const search = window.location.search;
  const promise = (async (): Promise<AuthEntryContext> => {
    if (readAuthIntent(search).next === "/clubs/new") return { method: "icp", error: null };
    const token = readEmailSignupInviteToken(search);
    if (!token) return { method: null, error: null };
    const onChain = token.startsWith("pinv-") || /^tok-[a-f0-9]{32}$/.test(token);
    // Token format only selects the existing preview transport, not authority.
    // Boot calls this before provider mount. No session/credentials are erased.
    setAuthMethodChoice(onChain ? "icp" : "supabase");
    try {
      const preview = onChain ? (async () => {
        const [{ readInvitePreview }, club] = await Promise.all([
          import("./invitePreview"), import("./features/club"),
        ]);
        const row = await readInvitePreview(token, {
          supabase: async () => null,
          icp: ctx => token.startsWith("pinv-")
            ? club.getLivePendingInvite(ctx, token)
            : club.getLiveTeamInviteLinkByToken(ctx, token),
        }, { forceIcp: true });
        if (!row) throw new Error("Unavailable invitation");
        return "icp" as const;
      })() : (async () => {
        // Let the explicit email provider mount before opening its transport;
        // a still-mounted ICP provider must continue rejecting Supabase calls.
        for (let attempt = 0; attempt < 200 && isIcpProviderMounted(); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (isIcpProviderMounted()) throw new Error("Email provider not ready");
        const { supabase } = await import("@/integrations/supabase/client");
        const results = await Promise.all([
          supabase.rpc("get_pending_invite_by_token", { _token: token }),
          supabase.rpc("get_team_invite_by_token", { _token: token }),
          supabase.rpc("get_club_invite_by_token", { _token: token }),
        ]);
        if (results.some(r => r.error || (r.data != null && !Array.isArray(r.data)))) throw new Error("Invitation verification failed");
        const now = Date.now();
        const clubs = results.flatMap((r, index) => (r.data ?? []).map(row => validPreviewClub(row, index, now)).filter((id): id is string => id !== null));
        const clubIds = new Set(clubs);
        if (clubIds.size !== 1) throw new Error("Unavailable invitation");
        const allowed = getBackendRoutingConfig().emailAuthClubs;
        if (allowed.length && !clubs.every(id => allowed.some(c => c.id === id))) {
          // A legacy token cannot be silently reinterpreted as an ICP invite.
          throw new Error("Unsupported invitation");
        }
        return "supabase" as const;
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const method = await Promise.race([preview, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Invitation timed out")), 10000);
        })]);
        return { method, error: null };
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) {
      console.warn("[Auth] Invitation preview unavailable", error);
      return { method: null, error: "We couldn't verify your invitation. Retry, or ask your organiser for a fresh link." };
    }
  })();
  pending = { key, promise };
  const result = await promise;
  if (authEntryKey() === key) entry = { key, result };
  if (pending?.key === key) pending = null;
  if (result.method && authEntryKey() === key) setAuthMethodChoice(result.method);
  return result;
}