import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSyntheticUser,
  service,
  type SyntheticUser,
} from "./fixtures";

type SeasonFixture = {
  clubId: string;
  sourceSeasonId: string;
  oldTeams: Array<{ id: string; name: string }>;
  players: Array<{ id: string; childId: string; teamId: string }>;
};

describe("local journey: archive a season and establish the next one", () => {
  let admin: SyntheticUser;
  let ordinaryMember: SyntheticUser;
  let coach: SyntheticUser;
  let otherAdmin: SyntheticUser;
  const clubIds: string[] = [];
  const childIds: string[] = [];

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    [admin, ordinaryMember, coach, otherAdmin] = await Promise.all([
      createSyntheticUser("season-admin"),
      createSyntheticUser("season-member"),
      createSyntheticUser("season-coach"),
      createSyntheticUser("other-club-admin"),
    ]);
  });

  afterEach(async () => {
    if (clubIds.length) {
      await service.from("clubs").update({ current_season_id: null }).in("id", clubIds);
      await service.from("clubs").delete().in("id", clubIds.splice(0));
    }
    // Children are parent-scoped rather than club-scoped, so deleting the
    // synthetic club does not remove them. Explicit cleanup keeps the new
    // duplicate-child guard meaningful while isolating each journey case.
    if (childIds.length) {
      await service.from("children").delete().in("id", childIds.splice(0));
    }
  });

  afterAll(async () => {
    await Promise.all([admin, ordinaryMember, coach, otherAdmin]
      .filter(Boolean)
      .map((user) => service.auth.admin.deleteUser(user.id)));
  });

  async function createSeasonFixture(label: string): Promise<SeasonFixture> {
    // The cross-club fixture is intentionally created before the first fixture
    // is cleaned up. Give those children distinct identities so the canonical
    // duplicate guard is exercised without making the test data collide.
    const alexName = label === "cross-club" ? "Synthetic Cross Alex" : "Synthetic Alex";
    const blairName = label === "cross-club" ? "Synthetic Cross Blair" : "Synthetic Blair";
    const club = await service.from("clubs").insert({
      name: `Synthetic rollover ${label} ${crypto.randomUUID()}`,
      created_by: admin.id,
    }).select("id").single();
    expect(club.error).toBeNull();
    clubIds.push(club.data!.id);

    const season = await service.from("seasons").insert({
      club_id: club.data!.id,
      name: "2026 Season",
      status: "active",
      created_by: admin.id,
    }).select("id").single();
    expect(season.error).toBeNull();

    const teams = await service.from("teams").insert([
      {
        club_id: club.data!.id,
        season_id: season.data!.id,
        name: "U12 Blue",
        level_age: "U12",
        team_type: "football",
        default_pitch_format: "9v9",
        default_formation: "3-3-2",
        lifecycle_status: "active",
        created_by: admin.id,
      },
      {
        club_id: club.data!.id,
        season_id: season.data!.id,
        name: "U14 Gold",
        level_age: "U14",
        team_type: "football",
        default_pitch_format: "11v11",
        default_formation: "4-3-3",
        lifecycle_status: "active",
        created_by: admin.id,
      },
    ]).select("id, name");
    expect(teams.error).toBeNull();

    const u12 = teams.data!.find((team) => team.name === "U12 Blue")!;
    const u14 = teams.data!.find((team) => team.name === "U14 Gold")!;
    const roles = await service.from("user_roles").insert([
      { user_id: admin.id, role: "club_admin", club_id: club.data!.id },
      { user_id: ordinaryMember.id, role: "player", club_id: club.data!.id, team_id: u12.id },
      { user_id: coach.id, role: "coach", club_id: club.data!.id, team_id: u12.id },
    ]);
    expect(roles.error).toBeNull();

    const children = await service.from("children").insert([
      { parent_id: admin.id, name: alexName, year_of_birth: 2014 },
      { parent_id: ordinaryMember.id, name: blairName, year_of_birth: 2012 },
    ]).select("id, name");
    expect(children.error).toBeNull();
    childIds.push(...children.data!.map((child) => child.id));
    const alex = children.data!.find((child) => child.name === alexName)!;
    const blair = children.data!.find((child) => child.name === blairName)!;

    const guardian = await service.from("child_guardians").insert({
      child_id: alex.id,
      guardian_id: ordinaryMember.id,
      relationship_type: "guardian",
    });
    expect(guardian.error).toBeNull();

    const players = await service.from("club_players").insert([
      { club_id: club.data!.id, child_id: alex.id, display_name: alexName, date_of_birth: "2014-03-04" },
      { club_id: club.data!.id, child_id: blair.id, display_name: blairName, date_of_birth: "2012-06-07" },
    ]).select("id, child_id");
    expect(players.error).toBeNull();
    const alexPlayer = players.data!.find((player) => player.child_id === alex.id)!;
    const blairPlayer = players.data!.find((player) => player.child_id === blair.id)!;

    const memberships = await service.from("team_memberships").insert([
      { club_player_id: alexPlayer.id, team_id: u12.id, season_id: season.data!.id, role: "player" },
      { club_player_id: blairPlayer.id, team_id: u14.id, season_id: season.data!.id, role: "player" },
    ]);
    expect(memberships.error).toBeNull();
    const setCurrent = await service.from("clubs")
      .update({ current_season_id: season.data!.id }).eq("id", club.data!.id);
    expect(setCurrent.error).toBeNull();

    return {
      clubId: club.data!.id,
      sourceSeasonId: season.data!.id,
      oldTeams: teams.data!,
      players: [
        { id: alexPlayer.id, childId: alex.id, teamId: u12.id },
        { id: blairPlayer.id, childId: blair.id, teamId: u14.id },
      ],
    };
  }

  async function duplicate(fixture: SeasonFixture, name: string, copyStaff = true) {
    const result = await admin.client.rpc("duplicate_season_structure", {
      _source_season_id: fixture.sourceSeasonId,
      _new_season_name: name,
      _copy_staff: copyStaff,
    });
    expect(result.error).toBeNull();
    expect(result.data).toBeTruthy();
    return result.data as string;
  }

  it("preserves every active team when following the wizard's archive-then-duplicate order", async () => {
    const fixture = await createSeasonFixture("real-order");
    const archived = await admin.client.rpc("archive_season", { _season_id: fixture.sourceSeasonId });
    expect(archived.error).toBeNull();

    const nextSeasonId = await duplicate(fixture, "2027 Season");
    const copiedTeams = await service.from("teams")
      .select("name, level_age, lifecycle_status, is_archived")
      .eq("season_id", nextSeasonId)
      .order("name");
    expect(copiedTeams.error).toBeNull();
    expect(copiedTeams.data).toEqual([
      expect.objectContaining({ name: "U12 Blue", level_age: "U12", lifecycle_status: "draft", is_archived: false }),
      expect.objectContaining({ name: "U14 Gold", level_age: "U14", lifecycle_status: "draft", is_archived: false }),
    ]);

    const oldState = await service.from("teams")
      .select("lifecycle_status, is_archived, archived_at")
      .eq("season_id", fixture.sourceSeasonId);
    expect(oldState.data).toHaveLength(2);
    expect(oldState.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycle_status: "archived", is_archived: true, archived_at: expect.any(String) }),
    ]));
  });

  it("rejects an ordinary member without mutating the current season", async () => {
    const fixture = await createSeasonFixture("permissions");
    const archive = await ordinaryMember.client.rpc("archive_season", { _season_id: fixture.sourceSeasonId });
    const duplicateAttempt = await ordinaryMember.client.rpc("duplicate_season_structure", {
      _source_season_id: fixture.sourceSeasonId,
      _new_season_name: "Unauthorized 2027",
      _copy_staff: true,
    });
    expect(archive.error?.message).toContain("Only club admins");
    expect(duplicateAttempt.error?.message).toContain("Only club admins");

    const [season, teams, unauthorizedSeason] = await Promise.all([
      service.from("seasons").select("status, archived_at").eq("id", fixture.sourceSeasonId).single(),
      service.from("teams").select("id, is_archived").eq("season_id", fixture.sourceSeasonId),
      service.from("seasons").select("id").eq("club_id", fixture.clubId).eq("name", "Unauthorized 2027"),
    ]);
    expect(season.data).toEqual({ status: "active", archived_at: null });
    expect(teams.data).toHaveLength(2);
    expect(teams.data!.every((team) => !team.is_archived)).toBe(true);
    expect(unauthorizedSeason.data).toEqual([]);
  });

  it("maps selected players to explicit new teams, remains idempotent, and preserves guardian identity", async () => {
    const fixture = await createSeasonFixture("mapping");
    // Duplicate first here so downstream contract checks are not masked by the
    // dedicated archive-order regression test above.
    const nextSeasonId = await duplicate(fixture, "2027 Mapping Season");
    const nextTeams = await service.from("teams").select("id, name").eq("season_id", nextSeasonId);
    expect(nextTeams.error).toBeNull();
    const u12 = nextTeams.data!.find((team) => team.name === "U12 Blue")!;
    const u14 = nextTeams.data!.find((team) => team.name === "U14 Gold")!;

    const other = await createSeasonFixture("cross-club");
    const assignments = [
      { club_player_id: fixture.players[0].id, team_id: u14.id }, // deliberate grade-up
      { club_player_id: fixture.players[1].id, team_id: u12.id },
      { club_player_id: other.players[0].id, team_id: u12.id },
      { club_player_id: fixture.players[0].id, team_id: other.oldTeams[0].id },
      { club_player_id: fixture.players[0].id, team_id: null },
    ];
    const first = await admin.client.rpc("carry_over_players_to_teams", {
      _target_season_id: nextSeasonId,
      _assignments: assignments,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(2);
    const retry = await admin.client.rpc("carry_over_players_to_teams", {
      _target_season_id: nextSeasonId,
      _assignments: assignments,
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(0);

    const memberships = await service.from("team_memberships")
      .select("club_player_id, team_id, season_id, role, status")
      .eq("season_id", nextSeasonId)
      .order("club_player_id");
    expect(memberships.data).toHaveLength(2);
    expect(memberships.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ club_player_id: fixture.players[0].id, team_id: u14.id, role: "player", status: "active" }),
      expect.objectContaining({ club_player_id: fixture.players[1].id, team_id: u12.id, role: "player", status: "active" }),
    ]));

    const [playerIdentity, guardianLink] = await Promise.all([
      service.from("club_players").select("id, child_id").eq("id", fixture.players[0].id).single(),
      service.from("child_guardians").select("guardian_id").eq("child_id", fixture.players[0].childId),
    ]);
    expect(playerIdentity.data).toEqual({ id: fixture.players[0].id, child_id: fixture.players[0].childId });
    expect(guardianLink.data).toEqual([{ guardian_id: ordinaryMember.id }]);
  });

  it("copies staff but not prior player roles, then publishes only the new season", async () => {
    const fixture = await createSeasonFixture("staff-publish");
    const nextSeasonId = await duplicate(fixture, "2027 Published Season", true);
    const nextTeams = await service.from("teams").select("id, name").eq("season_id", nextSeasonId);
    const copiedU12 = nextTeams.data!.find((team) => team.name === "U12 Blue")!;
    const copiedRoles = await service.from("user_roles")
      .select("user_id, role, team_id")
      .in("team_id", nextTeams.data!.map((team) => team.id));
    expect(copiedRoles.data).toEqual([
      expect.objectContaining({ user_id: coach.id, role: "coach", team_id: copiedU12.id }),
    ]);

    await admin.client.rpc("archive_season", { _season_id: fixture.sourceSeasonId });
    const published = await admin.client.rpc("publish_season", { _season_id: nextSeasonId });
    expect(published.error).toBeNull();
    const [oldSeason, newSeason, oldTeams, activeTeams, club] = await Promise.all([
      service.from("seasons").select("status").eq("id", fixture.sourceSeasonId).single(),
      service.from("seasons").select("status").eq("id", nextSeasonId).single(),
      service.from("teams").select("id, lifecycle_status, is_archived").eq("season_id", fixture.sourceSeasonId),
      service.from("teams").select("id, lifecycle_status, is_archived").eq("season_id", nextSeasonId),
      service.from("clubs").select("current_season_id").eq("id", fixture.clubId).single(),
    ]);
    expect(oldSeason.data?.status).toBe("archived");
    expect(newSeason.data?.status).toBe("active");
    expect(oldTeams.data!.every((team) => team.lifecycle_status === "archived" && team.is_archived)).toBe(true);
    expect(activeTeams.data!.every((team) => team.lifecycle_status === "active" && !team.is_archived)).toBe(true);
    expect(club.data?.current_season_id).toBe(nextSeasonId);
  });

  it("returns only active players to club admins and honours copy-staff off", async () => {
    const fixture = await createSeasonFixture("returning-list");
    const listed = await admin.client.rpc("get_returning_players", { _source_season_id: fixture.sourceSeasonId });
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual([
      expect.objectContaining({ display_name: "Synthetic Alex", previous_team_name: "U12 Blue", membership_role: "player" }),
      expect.objectContaining({ display_name: "Synthetic Blair", previous_team_name: "U14 Gold", membership_role: "player" }),
    ]);
    const denied = await ordinaryMember.client.rpc("get_returning_players", { _source_season_id: fixture.sourceSeasonId });
    expect(denied.error).toBeNull();
    expect(denied.data).toEqual([]);

    const nextSeasonId = await duplicate(fixture, "2027 No Staff", false);
    const nextTeams = await service.from("teams").select("id").eq("season_id", nextSeasonId);
    const copiedStaff = await service.from("user_roles")
      .select("id")
      .in("team_id", nextTeams.data!.map((team) => team.id))
      .in("role", ["coach", "team_admin"]);
    expect(copiedStaff.data).toEqual([]);
  });

  it("does not resurrect a soft-deleted source team during rollover", async () => {
    const fixture = await createSeasonFixture("deleted-team");
    const removedTeam = fixture.oldTeams.find((team) => team.name === "U14 Gold")!;
    const softDelete = await service.from("teams")
      .update({ deleted_at: "2026-12-31T23:59:59.000Z" })
      .eq("id", removedTeam.id);
    expect(softDelete.error).toBeNull();

    const archived = await admin.client.rpc("archive_season", { _season_id: fixture.sourceSeasonId });
    expect(archived.error).toBeNull();
    const nextSeasonId = await duplicate(fixture, "2027 Without Deleted Team");
    const copiedTeams = await service.from("teams")
      .select("name, deleted_at, is_archived, lifecycle_status")
      .eq("season_id", nextSeasonId);

    expect(copiedTeams.error).toBeNull();
    expect(copiedTeams.data).toEqual([
      expect.objectContaining({
        name: "U12 Blue",
        deleted_at: null,
        is_archived: false,
        lifecycle_status: "draft",
      }),
    ]);
    expect(copiedTeams.data?.some((team) => team.name === "U14 Gold")).toBe(false);
  });
});
