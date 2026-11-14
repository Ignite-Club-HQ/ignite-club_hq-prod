import { describe, expect, it, vi } from "vitest";
import { DEV_TED_U10, type DevTedPreflight } from "./devTedU10TransferPreflight";
import {
  TED_COPY_APPROVAL, assertTedCopyReceipt, beginTedCopyOnce, continueTedCopy,
  type TedCopyActions, type TedCopyReceipt,
} from "./devTedU10CopyCoordinator";

const pinned: DevTedPreflight = {
  sourceChildId: DEV_TED_U10.sourceChildId,
  sourceCanister: DEV_TED_U10.sourceCanister,
  targetCanister: DEV_TED_U10.destinationCanister,
  targetClubId: DEV_TED_U10.targetClubId,
  targetTeamId: DEV_TED_U10.targetTeamId,
  name: "Ted",
  parentPrincipal: DEV_TED_U10.parentPrincipal,
  destinationEmpty: true,
  writeAuthorised: false,
};
const newId = "child-own-10-destination-only";

function harness() {
  let receipt: TedCopyReceipt | null = null;
  let isAssigned = false;
  let encryptedName: string | null = null;
  const actions: TedCopyActions = {
    principal: vi.fn(() => DEV_TED_U10.parentPrincipal),
    preflight: vi.fn(async () => pinned),
    checkSourcePreserved: vi.fn(async () => true),
    readReceipt: vi.fn(async () => receipt),
    claimCreateOnce: vi.fn(async (next: TedCopyReceipt) => {
      if (receipt) return false;
      receipt = next;
      return true;
    }),
    advanceReceipt: vi.fn(async (prior: TedCopyReceipt, next: TedCopyReceipt) => {
      if (JSON.stringify(receipt) !== JSON.stringify(prior)) throw Error("Receipt version conflict");
      receipt = next;
    }),
    createDestinationOwnChild: vi.fn(async () => ({ id: newId })),
    registerEncryptedName: vi.fn(async (_id: string, name: "Ted") => { encryptedName = name; }),
    readEncryptedName: vi.fn(async () => encryptedName),
    readDestinationChild: vi.fn(async () => ({
      id: newId, parent: DEV_TED_U10.parentPrincipal,
      guardians: [DEV_TED_U10.parentPrincipal],
      teams: isAssigned ? [DEV_TED_U10.targetTeamId] : [],
    })),
    assignDestinationU10: vi.fn(async () => { isAssigned = true; }),
    verifyStaffU10Roster: vi.fn(async () => true),
  };
  return { actions, getReceipt: () => receipt, setReceipt: (r: TedCopyReceipt) => { receipt=r; } };
}

describe("DEV Ted G2 staged copy coordinator: no automatic duplicate", () => {
  it("reserves journal atomically before the only child creation, then refuses replay", async () => {
    const h = harness();
    const first = await beginTedCopyOnce(TED_COPY_APPROVAL, h.actions);
    expect(first.phase).toBe("created");
    expect(first.targetChildId).toBe(newId);
    const events = (h.actions.claimCreateOnce as any).mock.invocationCallOrder[0];
    const create = (h.actions.createDestinationOwnChild as any).mock.invocationCallOrder[0];
    expect(events).toBeLessThan(create);
    expect(h.actions.createDestinationOwnChild).toHaveBeenCalledTimes(1);
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("already exists");
    expect(h.actions.createDestinationOwnChild).toHaveBeenCalledTimes(1);
    expect(h.getReceipt()?.phase).toBe("created");
  });

  it("rejects missing approval, different principal, stale preflight or changing G1", async () => {
    const h = harness();
    await expect(beginTedCopyOnce("Proceed", h.actions)).rejects.toThrow("authorisation");
    expect(h.actions.claimCreateOnce).not.toHaveBeenCalled();
    (h.actions.principal as any).mockReturnValueOnce("someone-else");
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("Parent changed");
    (h.actions.preflight as any).mockResolvedValueOnce({ ...pinned, destinationEmpty: false });
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("preflight");
    (h.actions.checkSourcePreserved as any).mockResolvedValueOnce(false);
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("Group 1");
    expect(h.actions.createDestinationOwnChild).not.toHaveBeenCalled();
  });

  it("never retries an unknown create after durable pending receipt", async () => {
    const h = harness();
    (h.actions.createDestinationOwnChild as any).mockRejectedValueOnce(Error("network lost after submission"));
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("network lost");
    expect(h.getReceipt()?.phase).toBe("create-pending");
    await expect(beginTedCopyOnce(TED_COPY_APPROVAL, h.actions)).rejects.toThrow("already exists");
    expect(h.actions.createDestinationOwnChild).toHaveBeenCalledTimes(1);
  });

  it("must decrypt destination name independently before assigning U10", async () => {
    const h = harness();
    const created = await beginTedCopyOnce(TED_COPY_APPROVAL, h.actions);
    (h.actions.readEncryptedName as any).mockResolvedValueOnce(null);
    await expect(continueTedCopy(created, h.actions)).rejects.toThrow("could not be independently read");
    expect(h.getReceipt()?.phase).toBe("name-pending");
    expect(h.actions.assignDestinationU10).not.toHaveBeenCalled();
    await expect(continueTedCopy(h.getReceipt()!, h.actions)).rejects.toThrow("may already have succeeded");
    expect(h.actions.registerEncryptedName).toHaveBeenCalledTimes(1);
  });

  it("stages verified name, single assignment and independent staff readback", async () => {
    const h = harness();
    const created = await beginTedCopyOnce(TED_COPY_APPROVAL, h.actions);
    const named = await continueTedCopy(created, h.actions);
    expect(named.phase).toBe("name-verified");
    expect(h.actions.assignDestinationU10).not.toHaveBeenCalled();
    const teamed = await continueTedCopy(named, h.actions);
    expect(teamed.phase).toBe("team-verified");
    expect(h.actions.assignDestinationU10).toHaveBeenCalledTimes(1);
    const complete = await continueTedCopy(teamed, h.actions);
    expect(complete.phase).toBe("staff-verified");
    await expect(continueTedCopy(complete, h.actions)).resolves.toEqual(complete);
    expect(h.actions.assignDestinationU10).toHaveBeenCalledTimes(1);
    expect(h.actions.createDestinationOwnChild).toHaveBeenCalledTimes(1);
  });

  it("blocks assignment if source was changed or destination has another guardian", async () => {
    const h = harness();
    const created = await beginTedCopyOnce(TED_COPY_APPROVAL, h.actions);
    (h.actions.readDestinationChild as any).mockResolvedValueOnce({
      id: newId, parent: DEV_TED_U10.parentPrincipal,
      guardians: [DEV_TED_U10.parentPrincipal, "another"], teams: [],
    });
    await expect(continueTedCopy(created, h.actions)).rejects.toThrow("guardians");
    expect(h.actions.registerEncryptedName).not.toHaveBeenCalled();
    expect(h.actions.assignDestinationU10).not.toHaveBeenCalled();
  });

  it("never replays team write after an unknown outcome", async () => {
    const h = harness();
    const created = await beginTedCopyOnce(TED_COPY_APPROVAL, h.actions);
    const named = await continueTedCopy(created, h.actions);
    (h.actions.assignDestinationU10 as any).mockRejectedValueOnce(Error("lost reply"));
    await expect(continueTedCopy(named, h.actions)).rejects.toThrow("lost reply");
    expect(h.getReceipt()?.phase).toBe("team-pending");
    await expect(continueTedCopy(h.getReceipt()!, h.actions)).rejects.toThrow("may already have succeeded");
    expect(h.actions.assignDestinationU10).toHaveBeenCalledTimes(1);
  });

  it("blocks corrupted or cross-group journal", () => {
    const r: TedCopyReceipt = {
      version: 1, sourceCanister: DEV_TED_U10.sourceCanister,
      sourceChildId: DEV_TED_U10.sourceChildId,
      targetCanister: DEV_TED_U10.destinationCanister,
      targetClubId: DEV_TED_U10.targetClubId,
      targetTeamId: DEV_TED_U10.targetTeamId,
      principal: DEV_TED_U10.parentPrincipal,
      phase: "created", targetChildId: newId,
    };
    expect(() => assertTedCopyReceipt(r)).not.toThrow();
    expect(() => assertTedCopyReceipt({ ...r, targetCanister: DEV_TED_U10.sourceCanister })).toThrow("invalid");
    expect(() => assertTedCopyReceipt({ ...r, targetChildId: null })).toThrow("invalid");
    expect(() => assertTedCopyReceipt({ ...r, phase: "create-pending" })).toThrow("invalid");
  });
});
