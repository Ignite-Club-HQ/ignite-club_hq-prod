import { getBackendRoutingConfig, isEmailAuthAllowlistActive } from "@/live/backendRouting";
import { readAuthIntent, safeSessionGet } from "./authRedirectStorage";

export const EMAIL_SIGNUP_INVITE_REQUIRED = "Email accounts are available by invitation for Bridgewater Soccer Club and Basket Range Cricket Club. For other clubs, continue with Internet Identity.";

export function readEmailSignupInviteToken(search: string): string | null {
  const intent = readAuthIntent(search);
  if (intent.invite) return intent.invite;
  const next = intent.next ?? safeSessionGet("redirectAfterAuth");
  if (!next) return null;
  const match = /^\/(?:join|join-team|join-club)\/([^/?#]+)(?:[?#]|$)/.exec(next);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function emailSignupRequiresInvite(): boolean {
  return isEmailAuthAllowlistActive(getBackendRoutingConfig());
}

/** UX check only; the account-creation trigger repeats authorization server-side. */
export async function validateEmailSignupInvite(
  client: { rpc: (name: any, args: any) => any },
  token: string | null,
  email: string,
  now = Date.now(),
): Promise<void> {
  const config = getBackendRoutingConfig();
  if (!isEmailAuthAllowlistActive(config)) return;
  if (!token) throw new Error(EMAIL_SIGNUP_INVITE_REQUIRED);
  const results = await Promise.all([
    client.rpc("get_pending_invite_by_token", { _token: token }),
    client.rpc("get_team_invite_by_token", { _token: token }),
    client.rpc("get_club_invite_by_token", { _token: token }),
  ]);
  if (results.some(result => result.error)) throw new Error("We couldn't verify your invitation. Please try again.");
  const allowed = new Set(config.emailAuthClubs.map(club => club.id));
  const valid = results.some((result, index) => (result.data ?? []).some((row: any) => {
    if (!allowed.has(String(row.club_id ?? "").toLowerCase())) return false;
    if (index === 0) return row.status === "pending" && typeof row.invited_email === "string"
      && row.invited_email.trim().toLowerCase() === email.trim().toLowerCase();
    if (row.expires_at != null && !(Date.parse(row.expires_at) > now)) return false;
    return row.max_uses == null || (typeof row.uses_count === "number" && row.uses_count < row.max_uses);
  }));
  if (!valid) throw new Error(EMAIL_SIGNUP_INVITE_REQUIRED);
}