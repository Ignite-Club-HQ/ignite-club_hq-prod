import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, type SecurityFixture } from "./fixtures";

describe("local RLS: roles and membership isolation", () => {
  let fixture: SecurityFixture;
  beforeAll(async () => { await assertSyntheticLocalMarker(); fixture = await createSecurityFixture(); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("lets a member see their own exact role", async () => {
    const result = await fixture.memberA.client.from("user_roles").select("role, club_id, team_id");
    expect(result.error).toBeNull();
    expect(result.data).toContainEqual({ role: "player", club_id: fixture.clubA, team_id: fixture.teamA });
  });

  it("does not expose another club's roles", async () => {
    const result = await fixture.memberA.client.from("user_roles").select("id").eq("club_id", fixture.clubB);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("prevents an ordinary member granting elevated access", async () => {
    const result = await fixture.memberA.client.from("user_roles").insert({
      user_id: fixture.memberA.id, role: "team_admin", club_id: fixture.clubA, team_id: fixture.teamA,
    });
    expect(result.error).not.toBeNull();
  });

  it("lets the owning club administrator grant a correctly scoped team role", async () => {
    const result = await fixture.adminA.client.from("user_roles").insert({
      user_id: fixture.memberA.id, role: "coach", club_id: fixture.clubA, team_id: fixture.teamA,
    }).select("id").single();
    expect(result.error).toBeNull();
  });

  it("prevents a club administrator mutating another club's membership", async () => {
    const result = await fixture.adminA.client.from("user_roles").delete().eq("user_id", fixture.outsiderB.id).eq("club_id", fixture.clubB).select("id");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});
