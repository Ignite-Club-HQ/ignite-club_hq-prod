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
  });

  afterAll(async () => {
    await fixture?.cleanup();
    if (committee?.id) await service.auth.admin.deleteUser(committee.id);
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
    }).select("id").single();
    expect(created.error).toBeNull();
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
});
