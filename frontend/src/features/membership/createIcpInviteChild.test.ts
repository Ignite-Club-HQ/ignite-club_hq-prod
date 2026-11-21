import { describe, expect, it, vi } from "vitest";
import { createIcpInviteChild, planIcpInviteChild } from "./createIcpInviteChild";

const input = { teamId: "team-g2", clubId: "club-g2", name: "Example Child" };
function actions() {
  return {
    readTeam: vi.fn(async () => ({ id: "team-g2", club_id: "club-g2" })),
    createOwnChild: vi.fn(async () => ({ id: "child-owned" })),
    saveName: vi.fn(async (_id: string) => undefined),
    assignOwnChildToTeam: vi.fn(async (_id: string) => undefined),
  };
}

describe("self-service ICP invite child onboarding", () => {
  it("verifies the target, creates through parent's own-child API, names and assigns the child", async () => {
    const a = actions();
    const result = await createIcpInviteChild(input, a);
    expect(result).toEqual({ status: "linked", childId: "child-owned" });
    expect(a.readTeam).toHaveBeenCalledTimes(1);
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.saveName).toHaveBeenCalledWith("child-owned");
    expect(a.assignOwnChildToTeam).toHaveBeenCalledWith("child-owned");
  });

  it.each<{ team: { id: string; club_id: string } | null; reason: string }>([
    { team: null, reason: "missing team" },
    { team: { id: "team-g2", club_id: "other-club" }, reason: "wrong club" },
    { team: { id: "other-team", club_id: "club-g2" }, reason: "wrong team" },
  ])("refuses to create a child for $reason", async ({ team }) => {
    const a = actions();
    a.readTeam.mockResolvedValue(team as any);
    await expect(createIcpInviteChild(input, a)).rejects.toThrow("Invitation team/club mismatch");
    expect(a.createOwnChild).not.toHaveBeenCalled();
    expect(a.saveName).not.toHaveBeenCalled();
    expect(a.assignOwnChildToTeam).not.toHaveBeenCalled();
  });

  it("reports a partial child, never automatically re-creates one after assignment failure", async () => {
    const a = actions();
    a.assignOwnChildToTeam.mockRejectedValue(new Error("Club membership required"));
    const result = await createIcpInviteChild(input, a);
    expect(result).toEqual({ status: "created_unlinked", childId: "child-owned", nameSaved: true });
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.saveName).toHaveBeenCalledTimes(1);
  });

  it("does not attempt child creation with an empty name", async () => {
    const a = actions();
    await expect(createIcpInviteChild({ ...input, name: " " }, a)).rejects.toThrow("required");
    expect(a.createOwnChild).not.toHaveBeenCalled();
  });

  it("does not replay child creation or assignment after an uncertain create failure", async () => {
    const a = actions();
    a.createOwnChild.mockRejectedValue(new Error("Account authority changed; retry"));
    await expect(createIcpInviteChild(input, a)).rejects.toThrow("Account authority changed; retry");
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.assignOwnChildToTeam).not.toHaveBeenCalled();
  });
  it("reports an encrypted-name failure without suppressing the team assignment", async () => {
    const a = actions();
    a.saveName.mockRejectedValue(new Error("PII service unavailable"));
    const result = await createIcpInviteChild(input, a);
    expect(result).toEqual({ status: "linked_without_name", childId: "child-owned" });
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.saveName).toHaveBeenCalledTimes(1);
    expect(a.assignOwnChildToTeam).toHaveBeenCalledWith("child-owned");
  });

  it("retains a confirmed child ID when both name and team writes fail", async () => {
    const a = actions();
    a.saveName.mockRejectedValue(new Error("PII temporarily unavailable"));
    a.assignOwnChildToTeam.mockRejectedValue(new Error("Team temporarily unavailable"));
    const result = await createIcpInviteChild(input, a);
    expect(result).toEqual({ status: "created_unlinked", childId: "child-owned", nameSaved: false });
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.assignOwnChildToTeam).toHaveBeenCalledTimes(1);
  });

  it("never requests a new child if target membership preflight refuses", async () => {
    const a = actions();
    a.readTeam.mockRejectedValue(new Error("No longer a club member"));
    await expect(createIcpInviteChild(input, a)).rejects.toThrow("No longer a club member");
    expect(a.createOwnChild).not.toHaveBeenCalled();
    expect(a.saveName).not.toHaveBeenCalled();
    expect(a.assignOwnChildToTeam).not.toHaveBeenCalled();
  });

  it("starts the independent team assignment without waiting for encrypted-name storage", async () => {
    const a = actions();
    let finishName: (() => void) | undefined;
    a.saveName.mockImplementation(() => new Promise<void>(resolve => { finishName = resolve; }));
    const inFlight = createIcpInviteChild(input, a);
    await vi.waitFor(() => expect(a.assignOwnChildToTeam).toHaveBeenCalledWith("child-owned"));
    expect(finishName).toBeTypeOf("function");
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    finishName?.();
    await expect(inFlight).resolves.toEqual({ status: "linked", childId: "child-owned" });
  });

  it("does not skip team assignment when the encrypted-name action throws synchronously", async () => {
    const a = actions();
    a.saveName.mockImplementation(() => { throw new Error("Unexpected PII failure"); });
    const result = await createIcpInviteChild(input, a);
    expect(result).toEqual({ status: "linked_without_name", childId: "child-owned" });
    expect(a.createOwnChild).toHaveBeenCalledTimes(1);
    expect(a.assignOwnChildToTeam).toHaveBeenCalledTimes(1);
  });

});

describe("invite child plan and recovery", () => {
  const fred = { id: "child-fred", teams: ["team-old"], name: "Fred" };
  it("creates a new child when only an unrelated child exists, even if its name is unreadable", () => {
    expect(planIcpInviteChild(input, [fred], null)).toEqual({ kind: "create" });
    expect(planIcpInviteChild(input, [{ ...fred, name: null }], null)).toEqual({ kind: "create" });
  });
  it("resumes the exact journaled child that was created but not linked", () => {
    const journal = { childId: "child-farty", teamId: "team-g2", clubId: "club-g2", name: "Example Child", nameSaved: false };
    const plan = planIcpInviteChild(input, [fred, { id: "child-farty", teams: [], name: null }], journal);
    expect(plan).toEqual({ kind: "recover", childId: "child-farty", needsTeam: true, needsName: true });
  });
  it("links an existing confirmed same-name child instead of creating a duplicate", () => {
    const plan = planIcpInviteChild(input, [fred, { id: "child-x", teams: [], name: " example child " }], null);
    expect(plan).toEqual({ kind: "recover", childId: "child-x", needsTeam: true, needsName: false });
  });
  it("refuses when two existing children share the name", () => {
    expect(() => planIcpInviteChild(input, [
      { id: "a", teams: [], name: "Example Child" }, { id: "b", teams: [], name: "Example Child" },
    ], null)).toThrow("More than one");
  });
  it("recovery never calls create and only repeats the missing step", async () => {
    const a = actions();
    const result = await createIcpInviteChild({ ...input, recover: { kind: "recover", childId: "child-farty", needsTeam: true, needsName: false } }, a);
    expect(result).toEqual({ status: "linked", childId: "child-farty", recovered: true });
    expect(a.createOwnChild).not.toHaveBeenCalled();
    expect(a.saveName).not.toHaveBeenCalled();
    expect(a.assignOwnChildToTeam).toHaveBeenCalledWith("child-farty");
  });
});
