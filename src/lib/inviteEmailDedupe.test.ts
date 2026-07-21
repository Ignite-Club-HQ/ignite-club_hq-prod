import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { lookupInvitableUserByEmail } from "./inviteEmailDedupe";

describe("lookupInvitableUserByEmail", () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: [], error: null }); });

  it.each(["", "   ", "not-an-email", "x@", "@example.test"])("rejects malformed email %j locally", async (email) => {
    await expect(lookupInvitableUserByEmail({ email })).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes email and passes every membership scope explicitly", async () => {
    await lookupInvitableUserByEmail({ email: "  Alex@Example.TEST ", clubId: "club-1", teamId: "team-1", miniLeagueId: "league-1" });
    expect(rpc).toHaveBeenCalledWith("lookup_invitable_user_by_email", {
      _email: "alex@example.test", _club_id: "club-1", _team_id: "team-1", _mini_league_id: "league-1",
    });
  });

  it("passes absent scopes as null rather than leaking previous context", async () => {
    await lookupInvitableUserByEmail({ email: "alex@example.test" });
    expect(rpc).toHaveBeenCalledWith("lookup_invitable_user_by_email", expect.objectContaining({ _club_id: null, _team_id: null, _mini_league_id: null }));
  });

  it("returns only the first scoped RPC match", async () => {
    const match = { user_id: "user-1", display_name: "Alex", avatar_url: null, already_in_club: true, already_in_team: false, already_in_mini_league: false };
    rpc.mockResolvedValue({ data: [match], error: null });
    await expect(lookupInvitableUserByEmail({ email: "alex@example.test", clubId: "club-1" })).resolves.toEqual(match);
  });

  it("fails privacy-safe when the lookup is denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "RLS denied" } });
    await expect(lookupInvitableUserByEmail({ email: "alex@example.test" })).resolves.toBeNull();
  });

  it("rejects malformed RPC response data rather than treating it as a user match", async () => {
    rpc.mockResolvedValue({ data: "unexpected", error: null });
    await expect(lookupInvitableUserByEmail({ email: "alex@example.test" })).resolves.toBeNull();
  });
});
