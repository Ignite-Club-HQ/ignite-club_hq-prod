import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local transaction: concurrent guardian invitation acceptance", () => {
  let fixture: SecurityFixture;

  beforeEach(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });
  afterEach(async () => { await fixture?.cleanup(); });

  async function createInvite() {
    const result = await service.from("pending_invites").insert({
      role: "parent",
      invited_by_user_id: fixture.adminA.id,
      invited_user_id: fixture.memberA.id,
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      invite_token: crypto.randomUUID(),
      metadata: { guardian_child_id: fixture.childA },
    }).select("id").single();
    if (result.error) throw result.error;
    return result.data.id;
  }

  it("serializes two simultaneous accept attempts without duplicate relationships", async () => {
    const inviteId = await createInvite();
    const attempts = await Promise.all([
      fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA }),
      fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA }),
    ]);
    expect(attempts.filter((attempt) => !attempt.error)).toHaveLength(1);
    const [invite, roles, guardians] = await Promise.all([
      service.from("pending_invites").select("status").eq("id", inviteId).single(),
      service.from("user_roles").select("id").eq("user_id", fixture.memberA.id).eq("role", "parent").eq("team_id", fixture.teamA),
      service.from("child_guardians").select("id").eq("guardian_id", fixture.memberA.id).eq("child_id", fixture.childA),
    ]);
    expect(invite.data?.status).toBe("accepted");
    expect(roles.data).toHaveLength(1);
    expect(guardians.data).toHaveLength(1);
  });

  it("does not let a competing unauthorized user win the invitation", async () => {
    const inviteId = await createInvite();
    const [authorized, unauthorized] = await Promise.all([
      fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA }),
      fixture.outsiderB.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA }),
    ]);
    expect(authorized.error).toBeNull();
    expect(unauthorized.error).not.toBeNull();
    expect((await service.from("child_guardians").select("id").eq("guardian_id", fixture.outsiderB.id)).data).toEqual([]);
  });

  it("remains consistent when a valid attempt races invalid child input", async () => {
    const inviteId = await createInvite();
    const [valid, invalid] = await Promise.all([
      fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA }),
      fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: crypto.randomUUID() }),
    ]);
    expect(valid.error).toBeNull();
    expect(invalid.error).not.toBeNull();
    expect((await service.from("pending_invites").select("status").eq("id", inviteId).single()).data?.status).toBe("accepted");
    expect((await service.from("child_guardians").select("id").eq("guardian_id", fixture.memberA.id)).data).toHaveLength(1);
  });
});
