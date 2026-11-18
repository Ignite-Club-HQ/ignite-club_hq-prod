import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  acceptPendingLiveInvite: vi.fn(),
  readReceipt: vi.fn(),
  invoke: vi.fn(),
  addRel: vi.fn(),
  grant: vi.fn(),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: { icp: (ctx: unknown) => Promise<unknown> }) =>
    providers.icp({ identity: Object.defineProperty({}, "getPrincipal", { value: () => "me" }), target: {} }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock("@/live/features/club", () => ({
  acceptPendingLiveInvite: mocks.acceptPendingLiveInvite,
  readLiveFamilyInviteReceipt: mocks.readReceipt,
}));
vi.mock("@/live/features/vault", () => ({ addLiveGuardianRelationship: mocks.addRel, grantLivePiiRead: mocks.grant }));

import { acceptIcpInviteAndWelcome } from "./acceptIcpInviteAndWelcome";

describe("acceptIcpInviteAndWelcome", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.addRel.mockReset().mockResolvedValue(undefined);
    mocks.grant.mockReset().mockResolvedValue(undefined);
    mocks.readReceipt.mockReset();
    mocks.readReceipt.mockResolvedValue({ child_ids: [], club_id: "club", team_id: ["team"], accepted_at_ms: 1n });
    mocks.acceptPendingLiveInvite.mockReset().mockImplementation(async () => {
      mocks.calls.push("accepted");
    });
    mocks.invoke.mockReset().mockImplementation(async () => {
      mocks.calls.push("email-requested");
      return { error: null };
    });
  });

  it("accepts on ICP without touching Supabase", async () => {
    await acceptIcpInviteAndWelcome("invite-1");

    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledWith(
      { identity: {}, target: {} },
      "invite-1",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual(["accepted"]);
  });

  it("keeps the accepted invite successful when Edge Function delivery fails", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.invoke.mockRejectedValueOnce(new Error("mail service unavailable"));

    await expect(acceptIcpInviteAndWelcome("invite-1")).resolves.toMatchObject({ child_ids: [], club_id: "club" });
    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
    logError.mockRestore();
  });
  it("returns the exact committed child IDs, not a current roster guess", async () => {
    mocks.readReceipt.mockResolvedValueOnce({ child_ids: [], club_id: "club", team_id: ["team"], accepted_at_ms: 7n });
    const receipt = await acceptIcpInviteAndWelcome("pinv-family");
    expect(receipt.accepted_at_ms).toBe(7n);
    expect(mocks.readReceipt).toHaveBeenCalledWith({ identity: {}, target: {} }, "pinv-family");
  });
  it('returns once child names are ready without waiting for optional details', async () => {
    vi.useFakeTimers();
    try {
      mocks.readReceipt.mockResolvedValueOnce({ child_ids: ['c1'], club_id: 'club', accepted_at_ms: 1n });
      mocks.grant.mockImplementation(async (_ctx, _id, field) => field === 'name' ? undefined : new Promise(() => {}));
      await expect(acceptIcpInviteAndWelcome('pinv-name')).resolves.toMatchObject({ child_ids: ['c1'] });
      expect(mocks.grant).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('does not replay acceptance or read a receipt after an uncertain write', async () => {
    mocks.acceptPendingLiveInvite.mockRejectedValueOnce(new Error('Unknown commit'));
    await expect(acceptIcpInviteAndWelcome('pinv-uncertain')).rejects.toThrow('Unknown commit');
    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledOnce();
    expect(mocks.readReceipt).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not hold acceptance longer than the wait cap on slow child grants", async () => {
    vi.useFakeTimers();
    try {
      mocks.readReceipt.mockResolvedValueOnce({ child_ids: ["c1", "c2"], club_id: "club", team_id: ["team"], accepted_at_ms: 1n });
      mocks.addRel.mockResolvedValue(undefined);
      mocks.grant.mockImplementation(() => new Promise(() => undefined));
      let done = false;
      const p = (async () => {
        const { acceptIcpInviteAndWelcome: run } = await import("./acceptIcpInviteAndWelcome");
        return run.call(null, "pinv-x");
      })().then((r) => { done = true; return r; });
      await vi.advanceTimersByTimeAsync(8_000);
      await p;
      expect(done).toBe(true);
      // Both children's three fields were requested in parallel.
      expect(mocks.grant).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
