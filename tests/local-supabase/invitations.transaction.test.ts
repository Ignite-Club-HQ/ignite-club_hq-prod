import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local transaction: guardian invitation acceptance", () => {
  let fixture: SecurityFixture;
  beforeAll(async () => { await assertSyntheticLocalMarker(); fixture = await createSecurityFixture(); });
  afterAll(async () => { await fixture?.cleanup(); });

  async function createInvite(userId = fixture.memberA.id) {
    const result = await service.from("pending_invites").insert({
      role: "parent", invited_by_user_id: fixture.adminA.id, invited_user_id: userId,
      club_id: fixture.clubA, team_id: fixture.teamA, invite_token: crypto.randomUUID(),
      metadata: { guardian_child_id: fixture.childA },
    }).select("id").single();
    if (result.error) throw result.error;
    return result.data.id;
  }

  it("atomically creates the role and guardian relationship before accepting", async () => {
    const inviteId = await createInvite();
    const accepted = await fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA });
    expect(accepted.error).toBeNull();
    const [invite, role, guardian] = await Promise.all([
      service.from("pending_invites").select("status, accepted_at").eq("id", inviteId).single(),
      service.from("user_roles").select("id").eq("user_id", fixture.memberA.id).eq("role", "parent").eq("team_id", fixture.teamA),
      service.from("child_guardians").select("id").eq("child_id", fixture.childA).eq("guardian_id", fixture.memberA.id),
    ]);
    expect(invite.data?.status).toBe("accepted");
    expect(role.data).toHaveLength(1);
    expect(guardian.data).toHaveLength(1);
  });

  it("rejects a different authenticated user without changing the invite", async () => {
    const inviteId = await createInvite();
    const result = await fixture.outsiderB.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA });
    expect(result.error).not.toBeNull();
    const invite = await service.from("pending_invites").select("status").eq("id", inviteId).single();
    expect(invite.data?.status).toBe("pending");
  });

  it("leaves no partial role and keeps the invite pending when required child validation fails", async () => {
    const inviteId = await createInvite();
    const invalidChild = crypto.randomUUID();
    const rolesBefore = await service.from("user_roles").select("id")
      .eq("user_id", fixture.memberA.id).eq("role", "parent").eq("team_id", fixture.teamA);
    expect(rolesBefore.error).toBeNull();
    const result = await fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: invalidChild });
    expect(result.error).not.toBeNull();
    const [invite, role] = await Promise.all([
      service.from("pending_invites").select("status").eq("id", inviteId).single(),
      service.from("user_roles").select("id").eq("user_id", fixture.memberA.id).eq("role", "parent").eq("team_id", fixture.teamA),
    ]);
    expect(invite.data?.status).toBe("pending");
    expect(role.data).toEqual(rolesBefore.data);
  });

  it("is idempotent for an existing guardian relationship", async () => {
    await service.from("child_guardians").upsert({ child_id: fixture.childA, guardian_id: fixture.memberA.id });
    const inviteId = await createInvite();
    const result = await fixture.memberA.client.rpc("accept_guardian_invite", { _invite_id: inviteId, _child_id: fixture.childA });
    expect(result.error).toBeNull();
    const guardians = await service.from("child_guardians").select("id").eq("child_id", fixture.childA).eq("guardian_id", fixture.memberA.id);
    expect(guardians.data).toHaveLength(1);
  });
});
