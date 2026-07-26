import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

describe("local journey: club-wide game RSVP grouping", () => {
  let fixture: SecurityFixture;
  let committee: SyntheticUser;
  let nonTargetMember: SyntheticUser;
  let secondClubATeam: string;
  let thirdClubATeam: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    committee = await createSyntheticUser("committee-game");
    const role = await service.from("user_roles").insert({
      user_id: committee.id,
      role: "committee_member",
      club_id: fixture.clubA,
    });
    if (role.error) throw role.error;

    const extraTeams = await service.from("teams").insert([
      {
        name: "Synthetic Alpha Red",
        club_id: fixture.clubA,
        created_by: fixture.adminA.id,
      },
      {
        name: "Synthetic Alpha Gold",
        club_id: fixture.clubA,
        created_by: fixture.adminA.id,
      },
    ]).select("id");
    if (extraTeams.error || extraTeams.data.length !== 2) {
      throw extraTeams.error ?? new Error("Target-team fixtures were not created");
    }
    [secondClubATeam, thirdClubATeam] = extraTeams.data.map(({ id }) => id);

    nonTargetMember = await createSyntheticUser("non-target-game-member");
    const nonTargetRole = await service.from("user_roles").insert({
      user_id: nonTargetMember.id,
      role: "player",
      club_id: fixture.clubA,
      team_id: secondClubATeam,
    });
    if (nonTargetRole.error) throw nonTargetRole.error;
  });

  afterAll(async () => {
    await fixture?.cleanup();
    if (committee?.id) await service.auth.admin.deleteUser(committee.id);
    if (nonTargetMember?.id) {
      await service.auth.admin.deleteUser(nonTargetMember.id);
    }
  });

  it("allows a club admin to create and regroup a club-wide game", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Club Game",
      type: "game",
      event_date: "2099-08-01T10:00:00.000Z",
      rsvp_grouping: "level",
    }).select("id, team_id, rsvp_grouping").single();
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({ team_id: null, rsvp_grouping: "level" });

    const regrouped = await fixture.adminA.client.from("events")
      .update({ rsvp_grouping: "team" }).eq("id", created.data!.id)
      .select("rsvp_grouping").single();
    expect(regrouped.error).toBeNull();
    expect(regrouped.data?.rsvp_grouping).toBe("team");
  });

  it("rejects invalid grouping values and grouping on a team event", async () => {
    const invalid = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Invalid Group",
      type: "game",
      event_date: "2099-08-02T10:00:00.000Z",
      rsvp_grouping: "squad",
    });
    expect(invalid.error).not.toBeNull();

    const teamGrouped = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Team Group",
      type: "game",
      event_date: "2099-08-03T10:00:00.000Z",
      rsvp_grouping: "team",
    });
    expect(teamGrouped.error).not.toBeNull();
  });

  it("denies ordinary members and cross-club admins", async () => {
    for (const actor of [fixture.memberA, fixture.outsiderB]) {
      const result = await actor.client.from("events").insert({
        club_id: fixture.clubA,
        team_id: null,
        created_by: actor.id,
        title: "Synthetic Unauthorized Club Game",
        type: "game",
        event_date: "2099-08-04T10:00:00.000Z",
        rsvp_grouping: "level",
      });
      expect(result.error).not.toBeNull();
    }
  });

  it("allows a committee member to create the intended club-wide game", async () => {
    const created = await committee.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: committee.id,
      title: "Synthetic Committee Club Game",
      type: "game",
      event_date: "2099-08-05T10:00:00.000Z",
      rsvp_grouping: "team",
      target_team_ids: [fixture.teamA, secondClubATeam],
    }).select("id, target_team_ids").single();
    expect(created.error).toBeNull();
    expect(created.data?.target_team_ids).toEqual([
      fixture.teamA,
      secondClubATeam,
    ]);
  });

  it("prevents a committee member moving a permitted event across club or team boundaries", async () => {
    const social = await committee.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: committee.id,
      title: "Synthetic Committee Boundary Event",
      type: "social",
      event_date: "2099-08-06T10:00:00.000Z",
      rsvp_grouping: "level",
    }).select("id").single();
    expect(social.error).toBeNull();

    const crossClub = await committee.client.from("events")
      .update({ club_id: fixture.clubB }).eq("id", social.data!.id).select("id");
    expect(crossClub.error).not.toBeNull();

    const teamScoped = await committee.client.from("events")
      .update({ team_id: fixture.teamA, rsvp_grouping: null })
      .eq("id", social.data!.id).select("id");
    expect(teamScoped.error).not.toBeNull();

    const unchanged = await service.from("events")
      .select("club_id, team_id, rsvp_grouping").eq("id", social.data!.id).single();
    expect(unchanged.data).toEqual({
      club_id: fixture.clubA,
      team_id: null,
      rsvp_grouping: "level",
    });
  });

  it("persists a valid multi-team audience and allows it to be changed or cleared", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Targeted Club Game",
      type: "game",
      event_date: "2099-08-07T10:00:00.000Z",
      rsvp_grouping: "team",
      target_team_ids: [fixture.teamA, secondClubATeam],
    }).select("id, target_team_ids").single();

    expect(created.error).toBeNull();
    expect(created.data?.target_team_ids).toEqual([
      fixture.teamA,
      secondClubATeam,
    ]);

    const retargeted = await fixture.adminA.client.from("events")
      .update({ target_team_ids: [secondClubATeam, thirdClubATeam] })
      .eq("id", created.data!.id)
      .select("target_team_ids")
      .single();
    expect(retargeted.error).toBeNull();
    expect(retargeted.data?.target_team_ids).toEqual([
      secondClubATeam,
      thirdClubATeam,
    ]);

    const cleared = await fixture.adminA.client.from("events")
      .update({ target_team_ids: null })
      .eq("id", created.data!.id)
      .select("target_team_ids")
      .single();
    expect(cleared.error).toBeNull();
    expect(cleared.data?.target_team_ids).toBeNull();
  });

  it("rejects target teams outside the event club or missing from the database", async () => {
    for (const targetIds of [
      [fixture.teamA, fixture.teamB],
      [fixture.teamA, crypto.randomUUID()],
    ]) {
      const result = await fixture.adminA.client.from("events").insert({
        club_id: fixture.clubA,
        team_id: null,
        created_by: fixture.adminA.id,
        title: "Synthetic Invalid Target Club Game",
        type: "game",
        event_date: "2099-08-08T10:00:00.000Z",
        target_team_ids: targetIds,
      });
      expect(result.error).not.toBeNull();
    }
  });

  it("rejects targeting on a team event or unsupported event type", async () => {
    const teamScoped = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Invalid Team-Scoped Target",
      type: "game",
      event_date: "2099-08-09T10:00:00.000Z",
      target_team_ids: [fixture.teamA, secondClubATeam],
    });
    expect(teamScoped.error).not.toBeNull();

    const training = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Invalid Training Target",
      type: "training",
      event_date: "2099-08-10T10:00:00.000Z",
      target_team_ids: [fixture.teamA, secondClubATeam],
    });
    expect(training.error).not.toBeNull();
  });

  it("hides a targeted game from a same-club member outside all target teams", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Private Targeted Club Game",
      type: "game",
      event_date: "2099-08-11T10:00:00.000Z",
      target_team_ids: [fixture.teamA, thirdClubATeam],
    }).select("id").single();
    expect(created.error).toBeNull();

    const visible = await nonTargetMember.client.from("events")
      .select("id")
      .eq("id", created.data!.id);
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([]);
  });

  it("allows a targeted team member to see and RSVP to the game", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Visible Targeted Club Game",
      type: "game",
      event_date: "2099-08-11T11:00:00.000Z",
      target_team_ids: [fixture.teamA, thirdClubATeam],
    }).select("id").single();
    expect(created.error).toBeNull();

    const visible = await fixture.memberA.client.from("events")
      .select("id, target_team_ids")
      .eq("id", created.data!.id)
      .single();
    expect(visible.error).toBeNull();
    expect(visible.data?.target_team_ids).toContain(fixture.teamA);

    const rsvp = await fixture.memberA.client.from("rsvps").insert({
      event_id: created.data!.id,
      user_id: fixture.memberA.id,
      status: "going",
    }).select("status").single();
    expect(rsvp.error).toBeNull();
    expect(rsvp.data?.status).toBe("going");
  });

  it("returns the complete targeted roster only to authorised event managers", async () => {
    const teamMetadata = await service.from("teams").update({ age_group: "U8" })
      .in("id", [fixture.teamA, secondClubATeam]);
    expect(teamMetadata.error).toBeNull();

    const secondChild = await service.from("children").insert({
      parent_id: committee.id,
      name: "Synthetic Targeted Child",
      year_of_birth: 2018,
    }).select("id").single();
    expect(secondChild.error).toBeNull();
    const secondAssignment = await service.from("child_team_assignments").insert({
      child_id: secondChild.data!.id,
      team_id: secondClubATeam,
    });
    expect(secondAssignment.error).toBeNull();

    const event = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Grouped Read Path",
      type: "game",
      event_date: "2099-08-11T12:00:00.000Z",
      rsvp_grouping: "level",
      target_team_ids: [fixture.teamA, secondClubATeam],
    }).select("id").single();
    expect(event.error).toBeNull();

    const rsvps = await service.from("rsvps").insert([
      { event_id: event.data!.id, user_id: fixture.memberA.id, status: "going" },
      { event_id: event.data!.id, user_id: nonTargetMember.id, status: "maybe" },
      { event_id: event.data!.id, child_id: fixture.childA, status: "not_going" },
      { event_id: event.data!.id, child_id: secondChild.data!.id, status: "going" },
    ]);
    expect(rsvps.error).toBeNull();

    const expectedChildIds = new Set([fixture.childA, secondChild.data!.id]);
    const targetIds = [fixture.teamA, secondClubATeam];

    for (const actor of [fixture.adminA, committee]) {
      const roster = await actor.client.rpc("get_targeted_event_attendance_roster", {
        p_event_id: event.data!.id,
      });
      expect.soft(roster.error, `${actor.email}: scoped roster read`).toBeNull();
      const visibleChildren = new Set(
        (roster.data ?? []).filter((row: any) => row.kind === "child").map((row: any) => row.person_id),
      );
      expect.soft(visibleChildren, `${actor.email}: exact child scope`).toEqual(expectedChildIds);
      for (const row of roster.data ?? []) {
        expect.soft((row as any).team_ids.every((teamId: string) => targetIds.includes(teamId))).toBe(true);
      }

      const visibleRsvps = await actor.client.from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", event.data!.id);
      expect.soft(visibleRsvps.error, `${actor.email}: RSVP read`).toBeNull();
      expect.soft(visibleRsvps.data).toHaveLength(4);
    }

    // Cross-club viewers must not be able to enumerate the audience or RSVP
    // records merely by knowing the target-team or event identifiers.
    const outsiderRoles = await fixture.outsiderB.client.from("user_roles")
      .select("user_id")
      .eq("club_id", fixture.clubA)
      .in("team_id", targetIds);
    expect(outsiderRoles.error).toBeNull();
    expect(outsiderRoles.data).toEqual([]);
    const outsiderRsvps = await fixture.outsiderB.client.from("rsvps")
      .select("id")
      .eq("event_id", event.data!.id);
    expect(outsiderRsvps.error).toBeNull();
    expect(outsiderRsvps.data).toEqual([]);

    for (const actor of [fixture.outsiderB, fixture.memberA, nonTargetMember]) {
      const roster = await actor.client.rpc("get_targeted_event_attendance_roster", {
        p_event_id: event.data!.id,
      });
      expect.soft(roster.error, `${actor.email}: denied scoped roster call`).toBeNull();
      expect.soft(roster.data, `${actor.email}: scoped roster must be empty`).toEqual([]);
    }
  });

  it("rejects an RSVP from a same-club member outside all target teams", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Targeted RSVP Boundary",
      type: "game",
      event_date: "2099-08-12T10:00:00.000Z",
      target_team_ids: [fixture.teamA, thirdClubATeam],
    }).select("id").single();
    expect(created.error).toBeNull();

    const rsvp = await nonTargetMember.client.from("rsvps").insert({
      event_id: created.data!.id,
      user_id: nonTargetMember.id,
      status: "going",
    });
    expect(rsvp.error).not.toBeNull();
  });

  it("revokes update and delete access to an existing RSVP after its event is retargeted", async () => {
    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: null,
      created_by: fixture.adminA.id,
      title: "Synthetic Retargeted Existing RSVP",
      type: "game",
      event_date: "2099-08-13T10:00:00.000Z",
      target_team_ids: null,
    }).select("id").single();
    expect(created.error).toBeNull();

    const initialRsvp = await nonTargetMember.client.from("rsvps").insert({
      event_id: created.data!.id,
      user_id: nonTargetMember.id,
      status: "going",
    }).select("id").single();
    expect(initialRsvp.error).toBeNull();

    const retargeted = await fixture.adminA.client.from("events")
      .update({ target_team_ids: [fixture.teamA, thirdClubATeam] })
      .eq("id", created.data!.id);
    expect(retargeted.error).toBeNull();

    const updateAttempt = await nonTargetMember.client.from("rsvps")
      .update({ status: "not_going" })
      .eq("id", initialRsvp.data!.id)
      .select("id");
    expect(updateAttempt.data ?? []).toEqual([]);

    const deleteAttempt = await nonTargetMember.client.from("rsvps")
      .delete()
      .eq("id", initialRsvp.data!.id)
      .select("id");
    expect(deleteAttempt.data ?? []).toEqual([]);

    const unchanged = await service.from("rsvps")
      .select("status")
      .eq("id", initialRsvp.data!.id)
      .single();
    expect(unchanged.data?.status).toBe("going");
  });
});
