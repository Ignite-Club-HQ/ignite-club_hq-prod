import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

describe("local RLS: event-group and player-assignment isolation", () => {
  let fixture: SecurityFixture;
  let committee: SyntheticUser;
  let coach: SyntheticUser;
  let appAdmin: SyntheticUser;
  let leagueA: string;
  let leagueB: string;
  let eventA: string;
  let eventB: string;
  let groupA: string;
  let playerA: string;
  let playerA2: string;
  let playerB: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    committee = await createSyntheticUser("event-groups-committee");
    coach = await createSyntheticUser("event-groups-coach");
    appAdmin = await createSyntheticUser("event-groups-app-admin");

    const leagues = await service.from("mini_leagues").insert([
      { club_id: fixture.clubA, name: "Synthetic Alpha League" },
      { club_id: fixture.clubB, name: "Synthetic Beta League" },
    ]).select("id, club_id");
    if (leagues.error) throw leagues.error;
    leagueA = leagues.data.find((row) => row.club_id === fixture.clubA)!.id;
    leagueB = leagues.data.find((row) => row.club_id === fixture.clubB)!.id;

    const roles = await service.from("user_roles").insert([
      { user_id: committee.id, role: "committee_member", club_id: fixture.clubA },
      { user_id: coach.id, role: "coach", club_id: fixture.clubA },
      { user_id: appAdmin.id, role: "app_admin", club_id: null, team_id: null },
    ]);
    if (roles.error) throw roles.error;

    const events = await service.from("events").insert([
      {
        club_id: fixture.clubA,
        created_by: fixture.adminA.id,
        title: "Synthetic Alpha League Round",
        type: "mini_league",
        event_date: "2099-09-01T10:00:00.000Z",
        mini_league_id: leagueA,
      },
      {
        club_id: fixture.clubB,
        created_by: fixture.outsiderB.id,
        title: "Synthetic Beta League Round",
        type: "mini_league",
        event_date: "2099-09-01T10:00:00.000Z",
        mini_league_id: leagueB,
      },
    ]).select("id, club_id");
    if (events.error) throw events.error;
    eventA = events.data.find((row) => row.club_id === fixture.clubA)!.id;
    eventB = events.data.find((row) => row.club_id === fixture.clubB)!.id;

    const players = await service.from("mini_league_players").insert([
      { mini_league_id: leagueA, name: "Synthetic Alpha Player" },
      { mini_league_id: leagueA, name: "Synthetic Alpha Player Two" },
      { mini_league_id: leagueB, name: "Synthetic Beta Player" },
    ]).select("id, mini_league_id");
    if (players.error) throw players.error;
    playerA = players.data.find((row) => row.mini_league_id === leagueA)!.id;
    playerA2 = players.data.filter((row) => row.mini_league_id === leagueA)[1]!.id;
    playerB = players.data.find((row) => row.mini_league_id === leagueB)!.id;

    const group = await service.from("event_groups").insert({
      event_id: eventA,
      name: "Synthetic Match One",
      display_order: 1,
    }).select("id").single();
    if (group.error) throw group.error;
    groupA = group.data.id;

    const assignment = await service.from("event_group_players").insert({
      group_id: groupA,
      player_id: playerA,
      team: "a",
    });
    if (assignment.error) throw assignment.error;
  });

  afterAll(async () => {
    await service.from("clubs").delete().in("id", [fixture?.clubA, fixture?.clubB].filter(Boolean));
    await Promise.all(
      [committee, coach, appAdmin]
        .filter(Boolean)
        .map((user) => service.auth.admin.deleteUser(user.id)),
    );
    await fixture?.cleanup();
  });

  it("lets a club member read only their club's event groups and assignments", async () => {
    const [groups, assignments] = await Promise.all([
      fixture.memberA.client.from("event_groups").select("id, event_id, name"),
      fixture.memberA.client.from("event_group_players").select("group_id, player_id, team"),
    ]);
    expect(groups.error).toBeNull();
    expect(groups.data).toEqual([{ id: groupA, event_id: eventA, name: "Synthetic Match One" }]);
    expect(assignments.error).toBeNull();
    expect(assignments.data).toEqual([{ group_id: groupA, player_id: playerA, team: "a" }]);
  });

  it("does not expose another club's groups or player assignments", async () => {
    const [groups, assignments] = await Promise.all([
      fixture.outsiderB.client.from("event_groups").select("id").eq("event_id", eventA),
      fixture.outsiderB.client.from("event_group_players").select("id").eq("group_id", groupA),
    ]);
    expect(groups.error).toBeNull();
    expect(groups.data).toEqual([]);
    expect(assignments.error).toBeNull();
    expect(assignments.data).toEqual([]);
  });

  it("prevents an ordinary member creating, changing or deleting groups", async () => {
    const created = await fixture.memberA.client.from("event_groups").insert({
      event_id: eventA,
      name: "Member-created match",
    });
    expect(created.error).not.toBeNull();

    const updated = await fixture.memberA.client.from("event_groups")
      .update({ name: "Member edit" }).eq("id", groupA).select("id");
    expect(updated.error).toBeNull();
    expect(updated.data).toEqual([]);

    const removed = await fixture.memberA.client.from("event_groups")
      .delete().eq("id", groupA).select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([]);
  });

  it("allows the owning club administrator to create and manage a scoped group", async () => {
    const created = await fixture.adminA.client.from("event_groups").insert({
      event_id: eventA,
      name: "Admin-created match",
      display_order: 2,
    }).select("id").single();
    expect(created.error).toBeNull();

    const updated = await fixture.adminA.client.from("event_groups")
      .update({ pitch_name: "North" }).eq("id", created.data!.id)
      .select("pitch_name").single();
    expect(updated.error).toBeNull();
    expect(updated.data?.pitch_name).toBe("North");

    const removed = await fixture.adminA.client.from("event_groups")
      .delete().eq("id", created.data!.id).select("id");
    expect(removed.data).toEqual([{ id: created.data!.id }]);
  });

  it.each([
    ["committee member", () => committee],
    ["league coach", () => coach],
    ["application administrator", () => appAdmin],
  ])("allows the %s shown management controls by EventDetailPage to create a match", async (_label, getUser) => {
    const result = await getUser().client.from("event_groups").insert({
      event_id: eventA,
      name: `Role contract ${crypto.randomUUID()}`,
    }).select("id").single();
    expect(result.error).toBeNull();
  });

  it("prevents another club administrator managing this club's group", async () => {
    const update = await fixture.outsiderB.client.from("event_groups")
      .update({ name: "Cross-club edit" }).eq("id", groupA).select("id");
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);
  });

  it("rejects assigning a player from another club or mini-league", async () => {
    const result = await fixture.adminA.client.from("event_group_players").insert({
      group_id: groupA,
      player_id: playerB,
      team: "b",
    });
    expect(result.error).not.toBeNull();
  });

  it("rejects duplicate assignment of the same player to the same match", async () => {
    const result = await fixture.adminA.client.from("event_group_players").insert({
      group_id: groupA,
      player_id: playerA,
      team: "b",
    });
    expect(result.error?.code).toBe("23505");
  });

  it("rolls an atomic cross-match swap back when a destination player is out of scope", async () => {
    const secondGroup = await fixture.adminA.client.from("event_groups").insert({
      event_id: eventA,
      name: "Atomic swap destination",
    }).select("id").single();
    expect(secondGroup.error).toBeNull();

    const foreignAssignment = await service.from("event_group_players").insert({
      group_id: secondGroup.data!.id,
      player_id: playerB,
      team: "b",
    });
    expect(foreignAssignment.error).toBeNull();

    const swapped = await fixture.adminA.client.rpc("swap_event_group_players", {
      p_player1_id: playerA,
      p_player1_group_id: groupA,
      p_player1_team: "a",
      p_player2_id: playerB,
      p_player2_group_id: secondGroup.data!.id,
      p_player2_team: "b",
    });
    expect(swapped.error).not.toBeNull();

    const persisted = await service.from("event_group_players")
      .select("group_id, player_id, team")
      .in("group_id", [groupA, secondGroup.data!.id]);
    expect(persisted.data).toEqual(expect.arrayContaining([
      { group_id: groupA, player_id: playerA, team: "a" },
      { group_id: secondGroup.data!.id, player_id: playerB, team: "b" },
    ]));
  });

  it("moves a player between matches atomically and rejects invalid teams", async () => {
    const destination = await fixture.adminA.client.from("event_groups").insert({
      event_id: eventA, name: "Move destination",
    }).select("id").single();
    expect(destination.error).toBeNull();

    const moved = await fixture.adminA.client.rpc("move_event_group_player", {
      p_player_id: playerA,
      p_from_group_id: groupA,
      p_to_group_id: destination.data!.id,
      p_to_team: "b",
    });
    expect(moved.error).toBeNull();
    const persisted = await service.from("event_group_players")
      .select("group_id, team").eq("player_id", playerA).single();
    expect(persisted.data).toEqual({ group_id: destination.data!.id, team: "b" });

    const invalid = await fixture.adminA.client.rpc("move_event_group_player", {
      p_player_id: playerA,
      p_from_group_id: destination.data!.id,
      p_to_group_id: groupA,
      p_to_team: "invalid",
    });
    expect(invalid.error).not.toBeNull();
    const afterFailure = await service.from("event_group_players")
      .select("group_id, team").eq("player_id", playerA).single();
    expect(afterFailure.data).toEqual({ group_id: destination.data!.id, team: "b" });

    const restored = await fixture.adminA.client.rpc("move_event_group_player", {
      p_player_id: playerA,
      p_from_group_id: destination.data!.id,
      p_to_group_id: groupA,
      p_to_team: "a",
    });
    expect(restored.error).toBeNull();
  });

  it("denies an ordinary member's move and preserves the source assignment", async () => {
    const destination = await service.from("event_groups").insert({ event_id: eventA, name: "Denied move target" }).select("id").single();
    const moved = await fixture.memberA.client.rpc("move_event_group_player", {
      p_player_id: playerA,
      p_from_group_id: groupA,
      p_to_group_id: destination.data!.id,
      p_to_team: "b",
    });
    expect(moved.error).not.toBeNull();
    const persisted = await service.from("event_group_players")
      .select("group_id, team").eq("player_id", playerA).single();
    expect(persisted.data).toEqual({ group_id: groupA, team: "a" });
  });

  it("swaps two valid players across matches and swaps two teams within one match", async () => {
    const second = await fixture.adminA.client.from("event_groups").insert({ event_id: eventA, name: "Swap target" }).select("id").single();
    await fixture.adminA.client.from("event_group_players").insert({ group_id: second.data!.id, player_id: playerA2, team: "b" });

    const crossSwap = await fixture.adminA.client.rpc("swap_event_group_players", {
      p_player1_id: playerA,
      p_player1_group_id: groupA,
      p_player1_team: "a",
      p_player2_id: playerA2,
      p_player2_group_id: second.data!.id,
      p_player2_team: "b",
    });
    expect(crossSwap.error).toBeNull();
    const crossed = await service.from("event_group_players").select("group_id, player_id, team").in("player_id", [playerA, playerA2]);
    expect(crossed.data).toEqual(expect.arrayContaining([
      { group_id: second.data!.id, player_id: playerA, team: "b" },
      { group_id: groupA, player_id: playerA2, team: "a" },
    ]));

    const sameSwap = await fixture.adminA.client.rpc("swap_event_group_players", {
      p_player1_id: playerA,
      p_player1_group_id: second.data!.id,
      p_player1_team: "b",
      p_player2_id: playerA2,
      p_player2_group_id: groupA,
      p_player2_team: "a",
    });
    expect(sameSwap.error).toBeNull();
  });

  it("rolls a swap back when its second source assignment is missing", async () => {
    const before = await service.from("event_group_players").select("group_id, team").eq("player_id", playerA).single();
    const result = await fixture.adminA.client.rpc("swap_event_group_players", {
      p_player1_id: playerA,
      p_player1_group_id: before.data!.group_id,
      p_player1_team: before.data!.team,
      p_player2_id: playerA2,
      p_player2_group_id: crypto.randomUUID(),
      p_player2_team: "b",
    });
    expect(result.error).not.toBeNull();
    const after = await service.from("event_group_players").select("group_id, team").eq("player_id", playerA).single();
    expect(after.data).toEqual(before.data);
  });

  it("creates a complete replacement payload and its assignments atomically", async () => {
    const freshPlayer = await service.from("mini_league_players").insert({
      mini_league_id: leagueA,
      name: `Synthetic replacement player ${crypto.randomUUID()}`,
    }).select("id").single();
    expect(freshPlayer.error).toBeNull();
    const result = await fixture.adminA.client.rpc("replace_event_groups", {
      p_event_id: eventA,
      p_delete_existing: false,
      p_groups: [{
        name: "Generated Match",
        pitch_name: "Pitch 3",
        display_order: 3,
        team_a_color: "#111111",
        team_b_color: "#eeeeee",
        players: [{ player_id: freshPlayer.data!.id, team: "b" }],
      }],
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    const assignment = await service.from("event_group_players")
      .select("group_id, player_id, team").eq("group_id", result.data![0]).single();
    expect(assignment.data).toEqual({ group_id: result.data![0], player_id: freshPlayer.data!.id, team: "b" });
  });

  it("denies replacement by an ordinary member without deleting existing groups", async () => {
    const before = await service.from("event_groups").select("id").eq("event_id", eventA);
    const result = await fixture.memberA.client.rpc("replace_event_groups", {
      p_event_id: eventA,
      p_delete_existing: true,
      p_groups: [{ name: "Unauthorized replacement", players: [] }],
    });
    expect(result.error).not.toBeNull();
    const after = await service.from("event_groups").select("id").eq("event_id", eventA);
    expect(after.data).toEqual(expect.arrayContaining(before.data!));
  });

  it.each([
    ["invalid team", [{ name: "Invalid team", players: [{ player_id: () => playerA2, team: "x" }] }]],
    ["foreign player", [{ name: "Foreign player", players: [{ player_id: () => playerB, team: "a" }] }]],
  ])("rolls the entire replacement back for an %s payload", async (_label, template) => {
    const payload = template.map((group) => ({
      ...group,
      players: group.players.map((player) => ({ ...player, player_id: player.player_id() })),
    }));
    const before = await service.from("event_groups").select("id, name").eq("event_id", eventA);
    const result = await fixture.adminA.client.rpc("replace_event_groups", {
      p_event_id: eventA, p_delete_existing: true, p_groups: payload,
    });
    expect(result.error).not.toBeNull();
    const after = await service.from("event_groups").select("id, name").eq("event_id", eventA);
    expect(after.data).toEqual(expect.arrayContaining(before.data!));
  });

  it("rejects malformed replacement input without changing existing groups", async () => {
    const before = await service.from("event_groups").select("id").eq("event_id", eventA);
    const result = await fixture.adminA.client.rpc("replace_event_groups", {
      p_event_id: eventA, p_delete_existing: true, p_groups: { not: "an array" },
    });
    expect(result.error).not.toBeNull();
    const after = await service.from("event_groups").select("id").eq("event_id", eventA);
    expect(after.data).toEqual(expect.arrayContaining(before.data!));
  });

  it("rejects the same player appearing in multiple generated matches", async () => {
    const before = await service.from("event_groups").select("id").eq("event_id", eventA);
    const result = await fixture.adminA.client.rpc("replace_event_groups", {
      p_event_id: eventA,
      p_delete_existing: false,
      p_groups: [
        { name: "Duplicate A", players: [{ player_id: playerA2, team: "a" }] },
        { name: "Duplicate B", players: [{ player_id: playerA2, team: "b" }] },
      ],
    });
    expect(result.error).not.toBeNull();
    const after = await service.from("event_groups").select("id").eq("event_id", eventA);
    expect(after.data).toEqual(before.data);
  });

  it("cascades assignments when an authorized administrator deletes a group", async () => {
    const freshPlayer = await service.from("mini_league_players").insert({
      mini_league_id: leagueA,
      name: `Synthetic cascade player ${crypto.randomUUID()}`,
    }).select("id").single();
    expect(freshPlayer.error).toBeNull();
    const temporary = await fixture.adminA.client.from("event_groups").insert({
      event_id: eventA,
      name: "Temporary match",
    }).select("id").single();
    expect(temporary.error).toBeNull();
    const assignment = await fixture.adminA.client.from("event_group_players").insert({
      group_id: temporary.data!.id,
      player_id: freshPlayer.data!.id,
      team: "a",
    }).select("id").single();
    expect(assignment.error).toBeNull();

    const removed = await fixture.adminA.client.from("event_groups")
      .delete().eq("id", temporary.data!.id).select("id");
    expect(removed.error).toBeNull();
    const persisted = await service.from("event_group_players")
      .select("id").eq("id", assignment.data!.id);
    expect(persisted.data).toEqual([]);
  });
});
