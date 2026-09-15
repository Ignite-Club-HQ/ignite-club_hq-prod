import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

describe("local journey: canonical child identity, guardians and RSVP", () => {
  let fixture: SecurityFixture;
  let firstParent: SyntheticUser;
  let secondGuardian: SyntheticUser;
  let unrelatedUser: SyntheticUser;
  let canonicalChildId: string;
  let eventId: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    firstParent = await createSyntheticUser("canonical-first-parent");
    secondGuardian = await createSyntheticUser("canonical-second-guardian");
    unrelatedUser = await createSyntheticUser("canonical-unrelated-user");

    const roles = await service.from("user_roles").insert([
      { user_id: firstParent.id, role: "parent", club_id: fixture.clubA, team_id: fixture.teamA },
      { user_id: secondGuardian.id, role: "parent", club_id: fixture.clubA, team_id: fixture.teamA },
    ]);
    if (roles.error) throw roles.error;

    const canonical = await service.from("children").insert({
      parent_id: firstParent.id,
      name: "Ava Synthetic",
      year_of_birth: 2016,
    }).select("id").single();
    if (canonical.error) throw canonical.error;
    canonicalChildId = canonical.data.id;
    const [assignment, guardian] = await Promise.all([
      service.from("child_team_assignments").insert({
        child_id: canonicalChildId,
        team_id: fixture.teamA,
      }),
      service.from("child_guardians").insert({
        child_id: canonicalChildId,
        guardian_id: secondGuardian.id,
        relationship_type: "parent",
        is_primary: false,
      }),
    ]);
    if (assignment.error) throw assignment.error;
    if (guardian.error) throw guardian.error;

    const event = await service.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Canonical Child RSVP Event",
      type: "game",
      event_date: "2099-08-01T10:00:00.000Z",
    }).select("id").single();
    if (event.error) throw event.error;
    eventId = event.data.id;
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await Promise.all(
      [firstParent, secondGuardian, unrelatedUser]
        .filter(Boolean)
        .map((user) => service.auth.admin.deleteUser(user.id)),
    );
  });

  it("returns one canonical child for normalized repeat creation and links the second guardian", async () => {
    const first = await fixture.adminA.client.rpc("create_child_for_parent_on_team", {
      p_parent_user_id: firstParent.id,
      p_team_id: fixture.teamA,
      p_name: "  Ava Synthetic  ",
      p_year_of_birth: 2016,
    });
    expect(first.error).toBeNull();
    expect(first.data).toEqual(expect.any(String));
    const rpcChildId = first.data as string;

    const repeated = await Promise.all([
      fixture.adminA.client.rpc("create_child_for_parent_on_team", {
        p_parent_user_id: firstParent.id,
        p_team_id: fixture.teamA,
        p_name: "ava synthetic",
        p_year_of_birth: 2016,
      }),
      fixture.adminA.client.rpc("create_child_for_parent_on_team", {
        p_parent_user_id: secondGuardian.id,
        p_team_id: fixture.teamA,
        p_name: "AVA SYNTHETIC",
        p_year_of_birth: 2016,
      }),
    ]);
    expect(repeated.map((result) => result.error)).toEqual([null, null]);
    expect(repeated.map((result) => result.data)).toEqual([rpcChildId, rpcChildId]);

    const [children, assignments, guardianLinks] = await Promise.all([
      service.from("children").select("id, parent_id, name, year_of_birth")
        .ilike("name", "ava synthetic"),
      service.from("child_team_assignments").select("child_id, team_id")
        .eq("team_id", fixture.teamA).eq("child_id", rpcChildId),
      service.from("child_guardians").select("child_id, guardian_id")
        .eq("child_id", rpcChildId).eq("guardian_id", secondGuardian.id),
    ]);
    expect(children.error).toBeNull();
    expect(children.data).toEqual([expect.objectContaining({
      id: rpcChildId,
      name: "Ava Synthetic",
      year_of_birth: 2016,
    })]);
    expect(assignments.data).toEqual([{ child_id: rpcChildId, team_id: fixture.teamA }]);
    expect(guardianLinks.data).toEqual([{ child_id: rpcChildId, guardian_id: secondGuardian.id }]);
  });

  it("prevents a direct duplicate from bypassing the canonical creation boundary", async () => {
    const duplicate = await service.from("children").insert({
      parent_id: firstParent.id,
      name: " AVA SYNTHETIC ",
      year_of_birth: 2016,
    });
    expect(duplicate.error).not.toBeNull();

    const rows = await service.from("children").select("id")
      .ilike("name", "ava synthetic");
    expect(rows.data).toEqual([{ id: canonicalChildId }]);
  });

  it("allows either linked guardian to update one child RSVP without creating a second row", async () => {
    const firstResponse = await firstParent.client.from("rsvps").insert({
      event_id: eventId,
      user_id: firstParent.id,
      child_id: canonicalChildId,
      status: "going",
    });
    expect(firstResponse.error).toBeNull();

    const existing = await secondGuardian.client.from("rsvps")
      .select("id, child_id, status").eq("event_id", eventId).eq("child_id", canonicalChildId).single();
    expect(existing.error).toBeNull();
    expect(existing.data).toEqual(expect.objectContaining({ child_id: canonicalChildId, status: "going" }));

    const changed = await secondGuardian.client.from("rsvps")
      .update({ status: "maybe", user_id: secondGuardian.id }).eq("id", existing.data.id)
      .select("id, child_id, status").single();
    expect(changed.error).toBeNull();
    expect(changed.data).toEqual(expect.objectContaining({ child_id: canonicalChildId, status: "maybe" }));

    const rows = await service.from("rsvps").select("id, child_id, status")
      .eq("event_id", eventId).eq("child_id", canonicalChildId);
    expect(rows.data).toEqual([expect.objectContaining({ child_id: canonicalChildId, status: "maybe" })]);
  });

  it("denies an unrelated user from reading or changing the child RSVP", async () => {
    const visible = await unrelatedUser.client.from("rsvps").select("id")
      .eq("event_id", eventId).eq("child_id", canonicalChildId);
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([]);

    const write = await unrelatedUser.client.from("rsvps").insert({
      event_id: eventId,
      user_id: unrelatedUser.id,
      child_id: canonicalChildId,
      status: "going",
    });
    expect(write.error).not.toBeNull();
  });
});
