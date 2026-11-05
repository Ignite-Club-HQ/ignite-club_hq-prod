import { supabase } from '@/integrations/supabase/client';
import { readAuthIntent, safeSessionGet } from '@/lib/authRedirectStorage';

export const INVITE_REQUIRED = 'Email accounts are available by invitation. Otherwise, continue with Internet Identity.';
type EmailClub = { id: string; name: string };
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function emailClubsFromSetting(value: unknown): EmailClub[] {
  if (value == null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Unable to verify email signup availability.');
  const raw = (value as Record<string, unknown>).emailAuthClubs;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Unable to verify email signup availability.');
  const clubs = raw.map(row => {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !UUID.test(row.id)) {
      throw new Error('Unable to verify email signup availability.');
    }
    return { id: row.id.toLowerCase(), name: typeof row.name === 'string' ? row.name : '' };
  });
  if (new Set(clubs.map(c => c.id)).size !== clubs.length) throw new Error('Unable to verify email signup availability.');
  return clubs;
}

export function signupToken(search: string): string | null {
  const intent = readAuthIntent(search);
  if (intent.invite) return intent.invite;
  const next = intent.next ?? safeSessionGet('redirectAfterAuth');
  const match = next ? /^\/(?:join|join-team|join-club)\/([^/?#]+)(?:[?#]|$)/.exec(next) : null;
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}

/** UX only. The separate server trigger owns account-creation authorization. */
export async function prepareEmailSignup(email: string): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'backend_routing_config').maybeSingle();
  if (error) throw new Error('Unable to verify email signup availability. Please try again.');
  const clubs = emailClubsFromSetting(data?.value);
  const token = signupToken(window.location.search);
  if (!clubs.length) return token;
  if (!token) throw new Error(INVITE_REQUIRED);
  const names = ['get_pending_invite_by_token', 'get_team_invite_by_token', 'get_club_invite_by_token'] as const;
  const results = await Promise.all(names.map(name => supabase.rpc(name, { _token: token })));
  if (results.some(r => r.error || (r.data != null && !Array.isArray(r.data)))) throw new Error('Unable to verify your invitation. Please try again.');
  const allowed = new Set(clubs.map(c => c.id));
  const valid = results.some((result, i) => (result.data ?? []).some((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    if (typeof row.club_id !== 'string' || !allowed.has(row.club_id.toLowerCase())) return false;
    if (i === 0) return row.status === 'pending' && typeof row.invited_email === 'string'
      && row.invited_email.trim().toLowerCase() === email.trim().toLowerCase();
    if (row.expires_at != null && !(typeof row.expires_at === 'string' && Date.parse(row.expires_at) > Date.now())) return false;
    if (row.uses_count != null && (!Number.isSafeInteger(row.uses_count) || (row.uses_count as number) < 0)) return false;
    return row.max_uses == null || (Number.isSafeInteger(row.max_uses) && (row.max_uses as number) > 0
      && Number.isSafeInteger(row.uses_count) && (row.uses_count as number) >= 0 && (row.uses_count as number) < (row.max_uses as number));
  }));
  if (!valid) throw new Error(INVITE_REQUIRED);
  return token;
}

export function updateEmailClubsBeforeImage(before: unknown, clubs: EmailClub[]) {
  if (!before || typeof before !== 'object' || Array.isArray(before)) throw new Error('Existing routing setting required.');
  emailClubsFromSetting({ emailAuthClubs: clubs });
  return { ...before, emailAuthClubs: clubs };
}