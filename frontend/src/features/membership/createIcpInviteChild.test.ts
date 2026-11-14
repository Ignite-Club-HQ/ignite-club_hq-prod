import { describe, expect, it, vi } from "vitest";
import { createIcpInviteChild } from "./createIcpInviteChild";

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
    expect(result).toEqual({ status: "created_unlinked", childId: "child-owned" });
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
});
