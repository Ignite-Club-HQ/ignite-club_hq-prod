import { supabase } from "@/integrations/supabase/client";

export interface InviteDedupeMatch {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  already_in_club: boolean;
  already_in_team: boolean;
  already_in_mini_league: boolean;
}

/**
 * Looks up whether the given email already belongs to a member the caller
 * is allowed to see (i.e. someone in one of the caller's clubs/teams/mini-leagues).
 *
 * Returns `null` when:
 *  - email is empty / malformed
 *  - no account exists for that email
 *  - an account exists but is outside the caller's scope (privacy-safe;
 *    the standard email invite flow will still reach them, and
 *    auth.users email uniqueness prevents true duplicate accounts at acceptance time)
 *
 * Returns a match when the email belongs to an existing user the caller
 * shares context with. Use `already_in_*` flags to decide whether to
 * attach the role directly instead of sending a new email invite.
 */
export async function lookupInvitableUserByEmail(opts: {
  email: string;
  clubId?: string | null;
  teamId?: string | null;
  miniLeagueId?: string | null;
}): Promise<InviteDedupeMatch | null> {
  const email = opts.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const { data, error } = await supabase.rpc("lookup_invitable_user_by_email", {
    _email: email,
    _club_id: opts.clubId ?? null,
    _team_id: opts.teamId ?? null,
    _mini_league_id: opts.miniLeagueId ?? null,
  });

  if (error) {
    // Don't block the invite flow on a lookup error — just skip dedupe.
    console.warn("[inviteEmailDedupe] lookup failed", error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row as InviteDedupeMatch | null) ?? null;
}
