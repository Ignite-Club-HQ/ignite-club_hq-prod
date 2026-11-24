import { getBackendRoutingConfig, isEmailAuthAllowlistActive } from "@/live/backendRouting";
import { readAuthIntent, safeSessionGet } from "./authRedirectStorage";

export const EMAIL_SIGNUP_INVITE_REQUIRED = "New email accounts need a valid invitation from your club. Already have an email account? Sign in below.";

export function readEmailSignupInviteToken(search: string): string | null {
  const intent = readAuthIntent(search);
  if (intent.invite) return intent.invite;
  const next = intent.next ?? safeSessionGet("redirectAfterAuth");
  if (!next) return null;
  const match = /^\/(?:join\/p|join|join-team|join-club)\/([^/?#]+)(?:[?#]|$)/.exec(next);
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
  if (results.some(result => !result || result.error || (result.data != null && !Array.isArray(result.data)))) throw new Error("We couldn't verify your invitation. Please try again.");
  const allowed = new Set(config.emailAuthClubs.map(club => club.id));
  const valid = results.some((result, index) => (result.data ?? []).some((row: any) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    if (!allowed.has(String(row.club_id ?? "").toLowerCase())) return false;
    if (index === 0) return row.status === "pending" && row.invited_user_id == null
      && (row.invited_email == null || (typeof row.invited_email === "string"
        && (!row.invited_email.trim() || row.invited_email.trim().toLowerCase() === email.trim().toLowerCase())));
    if (row.expires_at != null && !(Date.parse(row.expires_at) > now)) return false;
    if (row.uses_count != null && (!Number.isSafeInteger(row.uses_count) || row.uses_count < 0)) return false;
    return row.max_uses == null || (Number.isSafeInteger(row.max_uses) && row.max_uses > 0
      && Number.isSafeInteger(row.uses_count) && row.uses_count >= 0 && row.uses_count < row.max_uses);
  }));
  if (!valid) {
    const rows = results.flatMap((result, index) => (result.data ?? []).map((row: any) => ({ row, index })));
    const entry = rows.find(({ row }: any) => row && typeof row === "object" && !Array.isArray(row));
    if (entry) {
      const { row, index } = entry;
      if (row.status === "expired" || (row.expires_at != null && !(Date.parse(row.expires_at) > now))) {
        throw new Error("This invitation has expired. Please ask your organiser for a new link.");
      }
      if ((index === 0 && (row.status !== "pending" || row.invited_user_id != null))
        || (row.max_uses != null && row.uses_count >= row.max_uses)) {
        throw new Error("This invitation has already been used. Please ask your organiser for a new link.");
      }
      if (index === 0 && typeof row.invited_email === "string" && row.invited_email.trim()
        && row.invited_email.trim().toLowerCase() !== email.trim().toLowerCase()) {
        throw new Error("This invitation is bound to a different email address. Use the invited email or ask your organiser for a new link.");
      }
      if (!allowed.has(String(row.club_id ?? "").toLowerCase())) {
        throw new Error("This club is not email-enabled. Continue with Internet Identity or contact your organiser.");
      }
    }
    throw new Error(EMAIL_SIGNUP_INVITE_REQUIRED);
  }
}