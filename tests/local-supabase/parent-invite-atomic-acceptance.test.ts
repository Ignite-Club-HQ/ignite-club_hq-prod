import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

type ChildInput = {
  name: string;
  yearOfBirth?: number | null;
  existingChildId?: string | null;
};

describe("local transaction: new-parent invite creates every required child", () => {
  let fixture: SecurityFixture;
  const users: SyntheticUser[] = [];
  const profilelessUserIds: string[] = [];

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await Promise.all(users.map((user) => service.auth.admin.deleteUser(user.id)));
    await Promise.all(profilelessUserIds.map((id) => service.auth.admin.deleteUser(id)));
  });

  async function newUser(label: string) {
    const user = await createSyntheticUser(label);
    users.push(user);
    return user;
  }

  async function createInvite(user: SyntheticUser, children: ChildInput[]) {
    const token = crypto.randomUUID();
    const result = await service.from("pending_invites").insert({
      role: "parent",
      invited_by_user_id: fixture.adminA.id,
      invited_user_id: user.id,
      invited_email: user.email,
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      invite_token: token,
      metadata: { children },
    }).select("id, invite_token").single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function createProfilelessUser(label: string) {
    const nonce = crypto.randomUUID();
    const email = `${label}.${nonce}@local.invalid`;
    const created = await service.auth.admin.createUser({
      email,
      password: `Local-only-${nonce}!`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("Local user creation failed");
    profilelessUserIds.push(created.data.user.id);
    return { id: created.data.user.id, email };
  }

  async function rowsFor(userId: string, inviteId: string) {
    return Promise.all([
      service.from("pending_invites").select("status, accepted_at, invited_user_id").eq("id", inviteId).single(),
      service.from("user_roles").select("id, role, club_id, team_id")
        .eq("user_id", userId).eq("role", "parent").eq("team_id", fixture.teamA),
      service.from("children").select("id, name, year_of_birth").eq("parent_id", userId),
    ]);
  }

  it("atomically creates one child, its team assignment, the parent role and acceptance", async () => {
    const parent = await newUser("parent-invite-one-child");
    const invite = await createInvite(parent, [{ name: " Synthetic New Child ", yearOfBirth: 2017 }]);

    const accepted = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id,
      _invite_token: null,
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toEqual(expect.objectContaining({
      success: true,
      team_id: fixture.teamA,
      club_id: fixture.clubA,
      child_ids: [expect.any(String)],
    }));

    const childId = (accepted.data as any).child_ids[0] as string;
    const [inviteRow, roles, children, assignment] = await Promise.all([
      service.from("pending_invites").select("status, accepted_at, invited_user_id").eq("id", invite.id).single(),
      service.from("user_roles").select("role, club_id, team_id")
        .eq("user_id", parent.id).eq("role", "parent").eq("team_id", fixture.teamA),
      service.from("children").select("id, parent_id, name, year_of_birth").eq("id", childId).single(),
      service.from("child_team_assignments").select("child_id, team_id")
        .eq("child_id", childId).eq("team_id", fixture.teamA),
    ]);
    expect(inviteRow.data).toEqual(expect.objectContaining({
      status: "accepted", invited_user_id: parent.id, accepted_at: expect.any(String),
    }));
    expect(roles.data).toEqual([{ role: "parent", club_id: fixture.clubA, team_id: fixture.teamA }]);
    expect(children.data).toEqual(expect.objectContaining({
      id: childId, parent_id: parent.id, name: "Synthetic New Child", year_of_birth: 2017,
    }));
    expect(assignment.data).toEqual([{ child_id: childId, team_id: fixture.teamA }]);
  });

  it("provisions a normal parent invite atomically from the profile-creation trigger", async () => {
    const parent = await createProfilelessUser("parent-invite-profile-trigger");
    const invite = await service.from("pending_invites").insert({
      role: "parent",
      invited_by_user_id: fixture.adminA.id,
      // A pre-signup email invite has no Auth user to reference yet. The
      // profile trigger must claim it by email and set invited_user_id only
      // after the account exists.
      invited_user_id: null,
      invited_email: parent.email,
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      invite_token: crypto.randomUUID(),
      metadata: { children: [{ name: "Synthetic Trigger Child", existingChildId: null }] },
    }).select("id").single();
    if (invite.error) throw invite.error;

    const profile = await service.from("profiles").insert({
      id: parent.id,
      display_name: "Synthetic Trigger Parent",
    });
    expect(profile.error).toBeNull();

    const [inviteRow, children, roles] = await Promise.all([
      service.from("pending_invites").select("status, invited_user_id").eq("id", invite.data.id).single(),
      service.from("children").select("id, name").eq("parent_id", parent.id),
      service.from("user_roles").select("role, club_id, team_id")
        .eq("user_id", parent.id).eq("role", "parent").eq("team_id", fixture.teamA),
    ]);
    expect(inviteRow.data).toEqual({ status: "accepted", invited_user_id: parent.id });
    expect(children.data).toEqual([{ id: expect.any(String), name: "Synthetic Trigger Child" }]);
    expect(roles.data).toEqual([{ role: "parent", club_id: fixture.clubA, team_id: fixture.teamA }]);

    const childId = children.data![0].id;
    const [guardian, assignment] = await Promise.all([
      service.from("child_guardians").select("child_id, guardian_id")
        .eq("child_id", childId).eq("guardian_id", parent.id),
      service.from("child_team_assignments").select("child_id, team_id")
        .eq("child_id", childId).eq("team_id", fixture.teamA),
    ]);
    expect(guardian.data).toEqual([{ child_id: childId, guardian_id: parent.id }]);
    expect(assignment.data).toEqual([{ child_id: childId, team_id: fixture.teamA }]);
  });

  it("denies direct recovery for another user's invite without creating children", async () => {
    const intended = await newUser("parent-invite-secure-recipient");
    const attacker = await newUser("parent-invite-secure-attacker");
    const invite = await createInvite(intended, [{ name: "Synthetic Protected Child" }]);

    const denied = await attacker.client.rpc("provision_invite_children" as any, {
      p_invite_id: invite.id,
    });
    expect(denied.error).not.toBeNull();
    expect(denied.error?.code).toBe("42501");

    const children = await service.from("children").select("id").eq("parent_id", intended.id);
    expect(children.data).toEqual([]);
  });

  it("prevents authenticated clients from executing the private provisioning function", async () => {
    const parent = await newUser("parent-invite-private-function");
    const invite = await createInvite(parent, [{ name: "Synthetic Private Child" }]);
    const denied = await parent.client.rpc("_provision_invite_children_internal" as any, {
      p_invite_id: invite.id,
      p_user_id: parent.id,
    });
    expect(denied.error).not.toBeNull();
    expect(denied.error?.code).toBe("42501");
  });

  it("creates and assigns every child before accepting a multi-child invite", async () => {
    const parent = await newUser("parent-invite-multiple-children");
    const invite = await createInvite(parent, [
      { name: "Synthetic Sibling One", yearOfBirth: 2015 },
      { name: "Synthetic Sibling Two", yearOfBirth: 2018 },
    ]);
    const accepted = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: null,
      _invite_token: invite.invite_token,
    });
    expect(accepted.error).toBeNull();
    expect((accepted.data as any).child_ids).toHaveLength(2);

    const childIds = (accepted.data as any).child_ids as string[];
    const [children, assignments] = await Promise.all([
      service.from("children").select("id, name").in("id", childIds),
      service.from("child_team_assignments").select("child_id, team_id")
        .in("child_id", childIds).eq("team_id", fixture.teamA),
    ]);
    expect(children.data).toHaveLength(2);
    expect(assignments.data).toHaveLength(2);
  });

  it("reuses an in-scope child and links the accepting parent as guardian", async () => {
    const parent = await newUser("parent-invite-existing-child");
    const invite = await createInvite(parent, [{
      name: "Synthetic Child",
      yearOfBirth: 2015,
      existingChildId: fixture.childA,
    }]);
    const before = await service.from("children").select("id", { count: "exact" });

    const accepted = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id,
      _invite_token: null,
    });
    expect(accepted.error).toBeNull();
    expect((accepted.data as any).child_ids).toEqual([fixture.childA]);

    const [after, guardian] = await Promise.all([
      service.from("children").select("id", { count: "exact" }),
      service.from("child_guardians").select("child_id, guardian_id")
        .eq("child_id", fixture.childA).eq("guardian_id", parent.id),
    ]);
    expect(after.count).toBe(before.count);
    expect(guardian.data).toEqual([{ child_id: fixture.childA, guardian_id: parent.id }]);
  });

  it("is idempotent when the same authenticated parent retries", async () => {
    const parent = await newUser("parent-invite-idempotent");
    const invite = await createInvite(parent, [{ name: "Synthetic Retry Child" }]);
    const first = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(first.error).toBeNull();

    const repeated = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data).toEqual(expect.objectContaining({ success: true, already_accepted: true }));

    const [, roles, children] = await rowsFor(parent.id, invite.id);
    expect(roles.data).toHaveLength(1);
    expect(children.data).toHaveLength(1);
  });

  it("rejects a different authenticated user without creating any partial rows", async () => {
    const intended = await newUser("parent-invite-intended");
    const attacker = await newUser("parent-invite-wrong-user");
    const invite = await createInvite(intended, [{ name: "Synthetic Protected Child" }]);

    const denied = await attacker.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(denied.error).not.toBeNull();

    const [inviteRow, roles, children] = await rowsFor(attacker.id, invite.id);
    expect(inviteRow.data?.status).toBe("pending");
    expect(roles.data).toEqual([]);
    expect(children.data).toEqual([]);
  });

  it("validates all children before writing and leaves malformed invites pending", async () => {
    const parent = await newUser("parent-invite-invalid-metadata");
    const invite = await createInvite(parent, [
      { name: "Synthetic Would Otherwise Exist" },
      { name: "   " },
    ]);
    const denied = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(denied.error).not.toBeNull();

    const [inviteRow, roles, children] = await rowsFor(parent.id, invite.id);
    expect(inviteRow.data?.status).toBe("pending");
    expect(inviteRow.data?.accepted_at).toBeNull();
    expect(roles.data).toEqual([]);
    expect(children.data).toEqual([]);
  });

  it("rolls back a child already inserted when its required team assignment fails", async () => {
    const parent = await newUser("parent-invite-forced-rollback");
    const invite = await createInvite(parent, [{ name: "Synthetic Force Rollback Child" }]);
    const denied = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(denied.error).not.toBeNull();
    expect(denied.error?.message).toContain("synthetic_child_team_assignment_failure");

    const [inviteRow, roles, children] = await rowsFor(parent.id, invite.id);
    expect(inviteRow.data?.status).toBe("pending");
    expect(inviteRow.data?.accepted_at).toBeNull();
    expect(roles.data).toEqual([]);
    expect(children.data).toEqual([]);
  });

  it("rejects a referenced child from another club without changing either club", async () => {
    const parent = await newUser("parent-invite-cross-club");
    const otherChild = await service.from("children").insert({
      parent_id: fixture.outsiderB.id,
      name: "Synthetic Other Club Child",
      year_of_birth: 2016,
    }).select("id").single();
    if (otherChild.error) throw otherChild.error;
    const assigned = await service.from("child_team_assignments").insert({
      child_id: otherChild.data.id,
      team_id: fixture.teamB,
    });
    if (assigned.error) throw assigned.error;
    const invite = await createInvite(parent, [{
      name: "Synthetic Other Club Child",
      existingChildId: otherChild.data.id,
    }]);

    const denied = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(denied.error).not.toBeNull();

    const [inviteRow, roles, guardian, originalChild, unrelatedParentRoles] = await Promise.all([
      service.from("pending_invites").select("status").eq("id", invite.id).single(),
      service.from("user_roles").select("id").eq("user_id", parent.id).eq("team_id", fixture.teamA),
      service.from("child_guardians").select("id")
        .eq("child_id", otherChild.data.id).eq("guardian_id", parent.id),
      service.from("children").select("id, parent_id").eq("id", otherChild.data.id).single(),
      service.from("user_roles").select("id")
        .eq("user_id", fixture.outsiderB.id).eq("club_id", fixture.clubA),
    ]);
    expect(inviteRow.data?.status).toBe("pending");
    expect(roles.data).toEqual([]);
    expect(guardian.data).toEqual([]);
    expect(originalChild.data).toEqual({ id: otherChild.data.id, parent_id: fixture.outsiderB.id });
    expect(unrelatedParentRoles.data).toEqual([]);
  });

  it("gives the accepted parent working child RSVP access", async () => {
    const parent = await newUser("parent-invite-rsvp");
    const invite = await createInvite(parent, [{ name: "Synthetic RSVP Child" }]);
    const accepted = await parent.client.rpc("accept_parent_team_invite", {
      _invite_id: invite.id, _invite_token: null,
    });
    expect(accepted.error).toBeNull();
    const childId = (accepted.data as any).child_ids[0] as string;

    const event = await service.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Parent Invite RSVP Event",
      type: "game",
      event_date: "2099-10-01T10:00:00.000Z",
    }).select("id").single();
    if (event.error) throw event.error;

    const response = await parent.client.from("rsvps").insert({
      event_id: event.data.id,
      user_id: parent.id,
      child_id: childId,
      status: "going",
      source: "user",
    }).select("user_id, child_id, status").single();
    expect(response.error).toBeNull();
    expect(response.data).toEqual({
      user_id: parent.id,
      child_id: childId,
      status: "going",
    });
  });
});
