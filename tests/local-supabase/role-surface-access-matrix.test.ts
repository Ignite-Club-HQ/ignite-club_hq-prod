import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

type MatrixRole = "club_admin" | "committee_member" | "team_admin" | "coach" | "player" | "parent" | "league_admin";
type Actor = { role: MatrixRole; user: SyntheticUser };

describe("local role workflows: messaging, Vault, events, and Media Gallery", () => {
  let f: SecurityFixture;
  let actors: Actor[] = [];
  const extraUsers: SyntheticUser[] = [];
  const eventIds: string[] = [];
  const photoIds: string[] = [];
  const vaultFileIds: string[] = [];

  const actor = (role: MatrixRole) => actors.find((entry) => entry.role === role)!;
  const expectInsert = async (result: { error: unknown }, allowed: boolean) => {
    if (allowed) expect(result.error).toBeNull();
    else expect(result.error).not.toBeNull();
  };

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    f = await createSecurityFixture();
    actors = [
      { role: "club_admin", user: f.adminA },
      { role: "player", user: f.memberA },
    ];
    for (const role of ["committee_member", "team_admin", "coach", "parent", "league_admin"] as const) {
      const user = await createSyntheticUser(`role-matrix-${role}`);
      extraUsers.push(user);
      const teamScoped = role === "team_admin" || role === "coach" || role === "parent";
      const inserted = await service.from("user_roles").insert({
        user_id: user.id,
        role,
        club_id: f.clubA,
        team_id: teamScoped ? f.teamA : null,
      });
      if (inserted.error) throw inserted.error;
      actors.push({ role, user });
    }
  });

  afterAll(async () => {
    if (eventIds.length) await service.from("events").delete().in("id", eventIds);
    if (photoIds.length) await service.from("photos").delete().in("id", photoIds);
    if (vaultFileIds.length) await service.from("vault_files").delete().in("id", vaultFileIds);
    await f?.cleanup();
    await Promise.all(extraUsers.map((user) => service.auth.admin.deleteUser(user.id)));
  });

  it.each([
    "club_admin", "committee_member", "team_admin", "coach", "player", "parent", "league_admin",
  ] as MatrixRole[])("lets the in-club %s read and send club messages", async (role) => {
    const current = actor(role);
    const sent = await current.user.client.from("club_messages").insert({
      club_id: f.clubA,
      author_id: current.user.id,
      text: `Synthetic ${role} club message`,
    }).select("id").single();
    expect(sent.error).toBeNull();
    const visible = await current.user.client.from("club_messages").select("id").eq("id", sent.data!.id);
    expect(visible.data).toEqual([{ id: sent.data!.id }]);
  });

  it.each([
    ["club_admin", true], ["committee_member", false], ["team_admin", true],
    ["coach", true], ["player", true], ["parent", true], ["league_admin", false],
  ] as Array<[MatrixRole, boolean]>)("enforces exact team-chat membership for %s", async (role, allowed) => {
    const current = actor(role);
    const sent = await current.user.client.from("team_messages").insert({
      team_id: f.teamA,
      author_id: current.user.id,
      text: `Synthetic ${role} team message`,
    });
    await expectInsert(sent, allowed);
  });

  it.each([
    ["club_admin", true], ["committee_member", true], ["team_admin", false],
    ["coach", false], ["player", false], ["parent", false], ["league_admin", false],
  ] as Array<[MatrixRole, boolean]>)("enforces club-wide game creation for %s", async (role, allowed) => {
    const current = actor(role);
    const created = await current.user.client.from("events").insert({
      club_id: f.clubA,
      team_id: null,
      created_by: current.user.id,
      title: `Synthetic ${role} club game`,
      type: "game",
      event_date: "2099-09-01T10:00:00.000Z",
    }).select("id").single();
    await expectInsert(created, allowed);
    if (created.data?.id) eventIds.push(created.data.id);
  });

  it.each([
    ["club_admin", true], ["committee_member", false], ["team_admin", true],
    ["coach", true], ["player", false], ["parent", false], ["league_admin", false],
  ] as Array<[MatrixRole, boolean]>)("enforces exact-team event creation for %s", async (role, allowed) => {
    const current = actor(role);
    const created = await current.user.client.from("events").insert({
      club_id: f.clubA,
      team_id: f.teamA,
      created_by: current.user.id,
      title: `Synthetic ${role} team training`,
      type: "training",
      event_date: "2099-09-02T10:00:00.000Z",
    }).select("id").single();
    await expectInsert(created, allowed);
    if (created.data?.id) eventIds.push(created.data.id);
  });

  it.each([
    ["club_admin", true], ["committee_member", true], ["team_admin", true],
    ["coach", true], ["player", false], ["parent", false], ["league_admin", false],
  ] as Array<[MatrixRole, boolean]>)("enforces club-wide Media Gallery publishing for %s", async (role, allowed) => {
    const current = actor(role);
    const inserted = await current.user.client.from("photos").insert({
      club_id: f.clubA,
      team_id: null,
      uploader_id: current.user.id,
      file_url: `https://local.invalid/${role}.jpg`,
      image_url: `https://local.invalid/${role}.jpg`,
      file_size: 1024,
      show_in_feed: true,
    }).select("id").single();
    await expectInsert(inserted, allowed);
    if (inserted.data?.id) photoIds.push(inserted.data.id);
  });

  it("keeps Vault destructive authority aligned to club and exact-team administration", async () => {
    const clubFile = await service.from("vault_files").insert({
      club_id: f.clubA,
      uploaded_by: f.memberA.id,
      file_url: "synthetic://role-matrix-club-file",
      file_size: 1024,
    }).select("id").single();
    const teamFile = await service.from("vault_files").insert({
      team_id: f.teamA,
      uploaded_by: f.adminA.id,
      file_url: "synthetic://role-matrix-team-file",
      file_size: 1024,
    }).select("id").single();
    if (clubFile.error || teamFile.error) throw clubFile.error ?? teamFile.error;
    vaultFileIds.push(clubFile.data.id, teamFile.data.id);

    const expected: Record<MatrixRole, { club: boolean; team: boolean }> = {
      club_admin: { club: true, team: true },
      committee_member: { club: true, team: true },
      team_admin: { club: false, team: true },
      coach: { club: false, team: false },
      player: { club: true, team: false }, // original uploader owns the club file
      parent: { club: false, team: false },
      league_admin: { club: false, team: false },
    };
    for (const current of actors) {
      const [clubAuth, teamAuth] = await Promise.all([
        service.rpc("authorize_vault_deletion", { _caller_id: current.user.id, _kind: "file", _record_id: clubFile.data.id }),
        service.rpc("authorize_vault_deletion", { _caller_id: current.user.id, _kind: "file", _record_id: teamFile.data.id }),
      ]);
      expect(clubAuth.error).toBeNull();
      expect(teamAuth.error).toBeNull();
      expect(clubAuth.data[0].authorized, `${current.role} club Vault authority`).toBe(expected[current.role].club);
      expect(teamAuth.data[0].authorized, `${current.role} team Vault authority`).toBe(expected[current.role].team);
    }
  });

  it("denies every role outside its club across all four surfaces", async () => {
    const foreign = f.outsiderB;
    expect((await foreign.client.from("club_messages").select("id").eq("club_id", f.clubA)).data).toEqual([]);
    expect((await foreign.client.from("team_messages").insert({ team_id: f.teamA, author_id: foreign.id, text: "Forbidden" })).error).not.toBeNull();
    expect((await foreign.client.from("events").insert({ club_id: f.clubA, team_id: f.teamA, created_by: foreign.id, title: "Forbidden", type: "training", event_date: "2099-09-03T10:00:00.000Z" })).error).not.toBeNull();
    expect((await foreign.client.from("photos").insert({ club_id: f.clubA, uploader_id: foreign.id, file_url: "https://local.invalid/forbidden.jpg", image_url: "https://local.invalid/forbidden.jpg", show_in_feed: true })).error).not.toBeNull();
  });
});
