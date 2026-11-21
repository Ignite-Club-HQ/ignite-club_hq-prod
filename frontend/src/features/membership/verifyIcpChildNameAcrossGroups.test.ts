import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  backend: vi.fn(),
  ownChildren: vi.fn(),
  names: vi.fn(),
}));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: mock.backend }));
vi.mock("@/live/features/club", () => ({ listMyLiveOwnChildren: mock.ownChildren }));
vi.mock("@/live/features/vault", () => ({ resolveLivePiiTextBatch: mock.names }));

import { verifyIcpChildNameAcrossGroups, verifyIcpChildNameInOtherGroups } from "./verifyIcpChildNameAcrossGroups";

const principal = { toText: () => "parent-verified" };
const groups = ["group-a", "group-b"].map(id => ({
  target: { canisterIds: { club_domain: id } },
  identity: { getPrincipal: () => principal },
}));

/** Mimic the dispatcher contract: an incomplete leg fails strict reads;
 * a best-effort read can return the successful legs. No ICP network calls. */
beforeEach(() => {
  vi.clearAllMocks();
  mock.backend.mockImplementation(async (_feature: unknown, providers: {
    icp: (ctx: unknown) => Promise<unknown>;
  }, scope: { requireComplete?: boolean; merge: (parts: unknown[]) => unknown }) => {
    const results: unknown[] = [];
    for (const group of groups) {
      try {
        results.push(await providers.icp(group));
      } catch (error) {
        if (scope.requireComplete) throw error;
      }
    }
    if (!results.length) throw new Error("No canister group answered");
    return scope.merge(results);
  });
  mock.ownChildren.mockImplementation(async (ctx: typeof groups[number]) =>
    ctx.target.canisterIds.club_domain === "group-a"
      ? []
      : [{ id: "child-b", parent: [principal], teams: [] }],
  );
  mock.names.mockResolvedValue(new Map([["child-b", "Mary"]]));
});

describe("parent invite's verified-other-group duplicate check", () => {
  it("rejects a confirmed matching child from another group before creation", async () => {
    await expect(verifyIcpChildNameInOtherGroups(" mArY ", "group-a"))
      .rejects.toThrow("already appears in your children in another club group");
    expect(mock.ownChildren).toHaveBeenCalledTimes(1); // source group skipped
    expect(mock.names).toHaveBeenCalledTimes(1);
  });

  it("does not treat an unresponsive other group as proof of a duplicate", async () => {
    mock.ownChildren.mockRejectedValueOnce(new Error("Other group unavailable"));
    await expect(verifyIcpChildNameInOtherGroups("Mary", "group-a"))
      .resolves.toBeUndefined();
  });

  it("does not treat an unreadable other-group name as a confirmed duplicate", async () => {
    mock.names.mockRejectedValueOnce(new Error("Encrypted name unavailable"));
    await expect(verifyIcpChildNameInOtherGroups("Mary", "group-a"))
      .resolves.toBeUndefined();
  });

  it("does not read or compare the invite's own group as an unrelated group", async () => {
    await expect(verifyIcpChildNameInOtherGroups("Mary", "group-b"))
      .resolves.toBeUndefined();
    expect(mock.ownChildren).toHaveBeenCalledTimes(1);
    expect(mock.names).not.toHaveBeenCalled();
  });
});

describe("My Children retains strict complete-inventory protection", () => {
  it("rejects a confirmed matching child", async () => {
    await expect(verifyIcpChildNameAcrossGroups("MARY")).rejects.toThrow("already appears in your children");
    expect(mock.backend.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ everyGroup: true, requireComplete: true }));
  });

  it("refuses to create when one group is unavailable", async () => {
    mock.ownChildren.mockRejectedValueOnce(new Error("A club group took too long to answer"));
    await expect(verifyIcpChildNameAcrossGroups("Another Child"))
      .rejects.toThrow("A club group took too long to answer");
  });

  it("refuses to create when an existing child's encrypted name is unresolved", async () => {
    mock.names.mockResolvedValueOnce(new Map());
    await expect(verifyIcpChildNameAcrossGroups("Another Child"))
      .rejects.toThrow("name could not be confirmed");
  });
});
