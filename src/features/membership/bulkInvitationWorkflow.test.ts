import { describe, expect, it, vi } from "vitest";
import { processBulkInvitationBatch } from "./bulkInvitationWorkflow";

const context = {
  teamId: "team-a",
  teamName: "Synthetic Team",
  clubId: "club-a",
  inviterUserId: "admin-a",
  roleLabel: (role: string) => role === "coach" ? "Coach" : role === "parent" ? "Parent" : undefined,
  clubChildren: [],
  customMessage: " Welcome ",
  appOrigin: "https://example.test",
  clubName: "Synthetic Club",
  clubLogoUrl: "https://example.test/logo.png",
  clubContactEmail: "club@example.test",
};

function operations() {
  const processExisting = vi.fn(async (input: { role: "parent" | "player" | "coach" | "team_admin" }) => ({
    memberResult: {
      name: "Existing User", email: "existing@example.test", link: "https://example.test/teams/team-a",
      sent: true as const, role: input.role, childrenCount: 0,
    },
    roleResult: { assigned: true, roleWasDuplicate: false, error: null },
    childOutcomes: [], selectedSecondGuardianResult: null, pendingSecondGuardianResult: null,
    notificationError: null,
  }));
  const processPending = vi.fn(async (input: { invitedName: string; invitedEmail: string; role: "parent" | "player" | "coach" | "team_admin"; childrenNames: string[] }) => ({
    memberResult: {
      name: input.invitedName.trim(), email: input.invitedEmail.trim(), link: "https://example.test/join/p/token",
      sent: false, role: input.role, childrenCount: input.childrenNames.length,
    },
    inviteError: null,
    deliveryResult: { sent: false, emailId: null, emailError: null, writeError: null },
  }));
  return { processExisting, processPending };
}

describe("bulk invitation batch orchestration", () => {
  it("processes mixed existing and pending recipients sequentially and preserves result order", async () => {
    const ops = operations();
    const order: string[] = [];
    ops.processExisting.mockImplementation(async (input) => {
      order.push("existing");
      return {
        memberResult: { name: "Existing User", email: "existing@example.test", link: "https://example.test/teams/team-a", sent: true, role: input.role, childrenCount: 0 },
        roleResult: { assigned: true, roleWasDuplicate: false, error: null }, childOutcomes: [],
        selectedSecondGuardianResult: null, pendingSecondGuardianResult: null, notificationError: null,
      };
    });
    ops.processPending.mockImplementation(async (input) => {
      order.push("pending");
      return {
        memberResult: { name: input.invitedName.trim(), email: input.invitedEmail.trim(), link: "https://example.test/join/p/token", sent: false, role: input.role, childrenCount: input.childrenNames.length },
        inviteError: null, deliveryResult: { sent: false, emailId: null, emailError: null, writeError: null },
      };
    });
    const outcome = await processBulkInvitationBatch([
      { name: "Existing User", email: "existing@example.test", role: "coach", children: [], selectedUser: { id: "user-a", display_name: "Existing User" } },
      { name: " Pending User ", email: "pending@example.test", role: "player", children: [] },
    ], context, ops);
    expect(order).toEqual(["existing", "pending"]);
    expect(outcome.results.map(result => result.name)).toEqual(["Existing User", "Pending User"]);
    expect(outcome.failures).toEqual([]);
  });

  it("passes exact parent metadata and linked tokens to two matching pending parents", async () => {
    const ops = operations();
    await processBulkInvitationBatch([
      { name: "Parent A", email: "a@example.test", role: "parent", children: [{ name: " Child A ", yearOfBirth: "2016" }] },
      { name: "Parent B", email: "b@example.test", role: "parent", children: [{ name: "Child A", yearOfBirth: "2016" }] },
    ], context, ops);
    expect(ops.processPending).toHaveBeenCalledTimes(2);
    const first = ops.processPending.mock.calls[0][0];
    const second = ops.processPending.mock.calls[1][0];
    expect(first.metadata?.linked_invite_token).toBe(second.inviteToken);
    expect(second.metadata?.linked_invite_token).toBe(first.inviteToken);
    expect(first.childrenNames).toEqual(["Child A"]);
  });

  it("normalizes omitted optional child fields before the existing-parent mutation boundary", async () => {
    const ops = operations();
    await processBulkInvitationBatch([{
      name: "Existing Parent",
      email: "parent@example.test",
      role: "parent",
      children: [{ name: "Child Without Optional Fields" }],
      selectedUser: { id: "parent-a", display_name: "Existing Parent" },
    }], context, ops);

    expect(ops.processExisting).toHaveBeenCalledWith(expect.objectContaining({
      children: [{
        name: "Child Without Optional Fields",
        yearOfBirth: "",
        jerseyNumber: "",
        existingChildId: undefined,
      }],
    }));
  });

  it("continues after an existing-role failure and reports only successful recipients", async () => {
    const ops = operations();
    const denied = { code: "42501", message: "role denied" };
    ops.processExisting.mockResolvedValueOnce({
      memberResult: null,
      roleResult: { assigned: false, roleWasDuplicate: false, error: denied },
      childOutcomes: [], selectedSecondGuardianResult: null, pendingSecondGuardianResult: null,
      notificationError: null,
    });
    const outcome = await processBulkInvitationBatch([
      { name: "Denied", email: "denied@example.test", role: "coach", children: [], selectedUser: { id: "denied", display_name: "Denied" } },
      { name: "Pending", email: "pending@example.test", role: "coach", children: [] },
    ], context, ops);
    expect(ops.processPending).toHaveBeenCalledOnce();
    expect(outcome.results).toHaveLength(1);
    expect(outcome.failures).toEqual([{ memberName: "Denied", error: denied }]);
  });

  it("continues after a pending-invite failure without claiming that recipient succeeded", async () => {
    const ops = operations();
    const denied = { code: "42501", message: "invite denied" };
    ops.processPending.mockResolvedValueOnce({ memberResult: null, inviteError: denied, deliveryResult: null });
    const outcome = await processBulkInvitationBatch([
      { name: "Denied", email: "denied@example.test", role: "coach", children: [] },
      { name: "Later", email: "later@example.test", role: "coach", children: [] },
    ], context, ops);
    expect(ops.processPending).toHaveBeenCalledTimes(2);
    expect(outcome.results.map(result => result.name)).toEqual(["Later"]);
    expect(outcome.failures).toEqual([{ memberName: "Denied", error: denied }]);
  });
});
