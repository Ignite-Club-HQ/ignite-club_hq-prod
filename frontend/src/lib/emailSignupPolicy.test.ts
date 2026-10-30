import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBackendRoutingConfig } from "@/live/backendRouting";
import { readEmailSignupInviteToken, validateEmailSignupInvite } from "./emailSignupPolicy";

const BRIDGE = "966bdaec-ebf1-46da-b2b3-cc53bf05c422";
const BASKET = "493ee2e3-c834-487d-93be-d1c8a0dbc4a8";
const OTHER = "0f2a1b6c-7d3e-4a5b-8c9d-0e1f2a3b4c5d";
const config = { defaultBackend: "supabase" as const, targets: [], countryTargets: {}, countryRules: {}, clubBackendOverrides: {}, emailAuthClubs: [
  { id: BRIDGE, name: "Bridgewater Soccer Club" }, { id: BASKET, name: "Basket Range Cricket Club" },
] };
const clientFor = (rpc: string, row: object) => ({ rpc: vi.fn(async (name: string) => ({ data: name === rpc ? [row] : [], error: null })) });
const now = Date.parse("2026-10-30T01:30:00Z");
beforeEach(() => { sessionStorage.clear(); applyBackendRoutingConfig(config); });
afterEach(() => applyBackendRoutingConfig(null));

describe("invitation-only email signup", () => {
  it("rejects an uninvited signup without making a lookup", async () => {
    const client = clientFor("", {});
    await expect(validateEmailSignupInvite(client, null, "new@example.test")).rejects.toThrow(/invitation/);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each([BRIDGE, BASKET])("allows a valid named invitation for email club %s", async club_id => {
    await expect(validateEmailSignupInvite(clientFor("get_pending_invite_by_token", { club_id, status: "pending", invited_email: "Invited@example.test" }), "token", " invited@example.test ")).resolves.toBeUndefined();
  });
  it("rejects a valid invitation for another club", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_team_invite_by_token", { club_id: OTHER, max_uses: null, expires_at: null }), "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it("rejects a mismatched named invitation email", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_pending_invite_by_token", { club_id: BRIDGE, status: "pending", invited_email: "invited@example.test" }), "token", "other@example.test")).rejects.toThrow(/invitation/);
  });
  it("rejects an already accepted named invitation", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_pending_invite_by_token", { club_id: BRIDGE, status: "accepted", invited_email: "new@example.test" }), "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it.each(["get_team_invite_by_token", "get_club_invite_by_token"])("allows a live unexhausted %s", async rpc => {
    await expect(validateEmailSignupInvite(clientFor(rpc, { club_id: BASKET, max_uses: 2, uses_count: 1, expires_at: "2026-10-31T01:30:00Z" }), "token", "new@example.test", now)).resolves.toBeUndefined();
  });
  it("rejects an expired invitation", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_team_invite_by_token", { club_id: BRIDGE, max_uses: null, expires_at: "2026-10-30T01:30:00Z" }), "token", "new@example.test", now)).rejects.toThrow(/invitation/);
  });
  it("rejects an exhausted invitation", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_club_invite_by_token", { club_id: BASKET, max_uses: 2, uses_count: 2, expires_at: null }), "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it("fails closed when an invitation lookup fails", async () => {
    await expect(validateEmailSignupInvite({ rpc: async () => ({ data: [], error: new Error("offline") }) }, "token", "new@example.test")).rejects.toThrow(/verify/);
  });
  it.each([{}, "invalid", 42])("rejects a malformed lookup payload %s", async data => {
    await expect(validateEmailSignupInvite({ rpc: async () => ({ data, error: null }) }, "token", "new@example.test")).rejects.toThrow(/verify/);
  });
  it.each([null, "invalid", 42, []])("rejects a malformed invitation row %s", async row => {
    await expect(validateEmailSignupInvite({ rpc: async () => ({ data: [row], error: null }) }, "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it.each([-1, 0.5, "1", NaN, Infinity])("rejects invalid usage count %s even without a use limit", async uses_count => {
    await expect(validateEmailSignupInvite(clientFor("get_team_invite_by_token", { club_id: BRIDGE, max_uses: null, uses_count }), "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it.each([-1, 0, 0.5, "2", NaN, Infinity])("rejects malformed use limit %s", async max_uses => {
    await expect(validateEmailSignupInvite(clientFor("get_club_invite_by_token", { club_id: BASKET, max_uses, uses_count: 0 }), "token", "new@example.test")).rejects.toThrow(/invitation/);
  });
  it("allows an unlimited invitation with a valid usage count", async () => {
    await expect(validateEmailSignupInvite(clientFor("get_team_invite_by_token", { club_id: BRIDGE, max_uses: null, uses_count: 3 }), "token", "new@example.test")).resolves.toBeUndefined();
  });
  it("keeps the existing open-signup behavior while the switch is off", async () => {
    applyBackendRoutingConfig({ ...config, emailAuthClubs: [] });
    const client = clientFor("", {});
    await expect(validateEmailSignupInvite(client, null, "new@example.test")).resolves.toBeUndefined();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("recovers the token from URL intent or a blocked-storage handoff", () => {
    expect(readEmailSignupInviteToken("?invite=abc")).toBe("abc");
    expect(readEmailSignupInviteToken("?next=%2Fjoin-club%2Fxyz")).toBe("xyz");
    sessionStorage.setItem("redirectAfterAuth", "/join/team-token?parent=true");
    expect(readEmailSignupInviteToken("")).toBe("team-token");
    expect(readEmailSignupInviteToken("?next=https://evil.test/join/abc")).toBeNull();
  });
});