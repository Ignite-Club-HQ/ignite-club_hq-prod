import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), choose: vi.fn(), preview: vi.fn(), allowed: [
  { id: "966bdaec-ebf1-46da-b2b3-cc53bf05c422", name: "Renamed club" },
  { id: "493ee2e3-c834-487d-93be-d1c8a0dbc4a8", name: "Another renamed club" },
] }));
vi.mock("./authBackendMode", () => ({ setAuthMethodChoice: state.choose, isIcpProviderMounted: () => false }));
vi.mock("./backendRouting", () => ({ getBackendRoutingConfig: () => ({ emailAuthClubs: state.allowed }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("./invitePreview", () => ({ readInvitePreview: state.preview }));
vi.mock("./features/club", () => ({ getLivePendingInvite: vi.fn(), getLiveTeamInviteLinkByToken: vi.fn() }));
import { prepareAuthEntryContext, readAuthEntryContext } from "./authEntryContext";
let n = 0;
function open(token: string) { window.history.replaceState({}, "", `/auth?invite=${token}&check=${++n}`); }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); state.rpc.mockResolvedValue({ data: [], error: null }); state.preview.mockResolvedValue({ club_id: "icp-club" }); });
afterEach(() => { vi.useRealTimers(); window.history.replaceState({}, "", "/"); });
describe("verified authentication entry", () => {
  it.each(state.allowed)("accepts the actual pending-invite RPC shape for $id", async club => {
    open("pending-token");
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "get_pending_invite_by_token" ? [{ club_id: club.id, status: "pending", invited_email: "member@example.com" }] : [] }));
    expect((await prepareAuthEntryContext()).method).toBe("supabase");
  });
  it.each(state.allowed)("uses canonical email club id $id, never its display name", async club => {
    open("legacy-token");
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "get_club_invite_by_token" ? [{ club_id: club.id, expires_at: null, uses_count: 0, max_uses: 3 }] : [] }));
    expect(await prepareAuthEntryContext()).toEqual({ method: "supabase", error: null });
    expect(state.choose).toHaveBeenLastCalledWith("supabase");
  });
  it("refuses a legacy token for an unapproved club instead of creating an ICP account", async () => {
    open("other-token"); state.rpc.mockResolvedValue({ data: [{ club_id: "other" }], error: null });
    expect((await prepareAuthEntryContext()).method).toBeNull();
    expect(state.preview).not.toHaveBeenCalled();
  });
  it("verifies ICP invites using existing anonymous cross-group preview only", async () => {
    open("pinv-test");
    expect((await prepareAuthEntryContext()).method).toBe("icp");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.preview).toHaveBeenCalledWith("pinv-test", expect.anything(), { forceIcp: true });
  });
  it("does not trust a fabricated ICP token", async () => {
    open("pinv-missing"); state.preview.mockResolvedValue(null);
    expect((await prepareAuthEntryContext()).method).toBeNull();
  });
  it("new clubs select Internet Identity without redeeming invites", async () => {
    window.history.replaceState({}, "", "/auth?next=%2Fclubs%2Fnew");
    expect((await prepareAuthEntryContext()).method).toBe("icp");
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.preview).not.toHaveBeenCalled();
  });
  it("rejects expired and exhausted invitations", async () => {
    open("expired"); state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "get_club_invite_by_token" ? [{ club_id: state.allowed[0]?.id, expires_at: "2020-01-01", uses_count: 2, max_uses: 2 }] : [] }));
    expect((await prepareAuthEntryContext()).method).toBeNull();
  });
  it("bounds failed verification and permits retry", async () => {
    vi.useFakeTimers(); open("pinv-stalled"); state.preview.mockImplementation(() => new Promise(() => {}));
    const request = prepareAuthEntryContext(); await vi.advanceTimersByTimeAsync(10000);
    expect((await request).method).toBeNull();
    state.preview.mockResolvedValue({ club_id: "icp-club" });
    expect((await prepareAuthEntryContext()).method).toBe("icp");
  });
  it("does not reuse another link's verified context", async () => {
    open("pinv-one"); await prepareAuthEntryContext(); open("pinv-two");
    expect(readAuthEntryContext()).toBeNull();
  });
});