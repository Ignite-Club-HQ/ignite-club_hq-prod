import { supabase } from "@/integrations/supabase/client";

type InviteClient = { rpc(name: "accept_legacy_club_invite", args: { _token: string }): PromiseLike<{ data: unknown; error: unknown }> };
/** Runtime bridge for an additive RPC while generated deployed schemas differ. */
export async function acceptLegacyClubInvite(token: string, expected: { clubId: string; role: string }) {
  const { data, error } = await (supabase as unknown as InviteClient).rpc("accept_legacy_club_invite", { _token: token });
  if (error) {
    console.error("[JoinClub] invitation acceptance refused", error);
    throw new Error("We couldn't accept this invitation. Reopen the link or ask your organiser for help.");
  }
  if (!data || typeof data !== "object" || !("club_id" in data) || !("role" in data) || !("already_member" in data)
      || data.club_id !== expected.clubId || data.role !== expected.role || typeof data.already_member !== "boolean") {
    throw new Error("We couldn't confirm your membership. Please reopen the invitation before trying again.");
  }
  return { clubId: expected.clubId, role: expected.role, alreadyMember: data.already_member };
}