import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local journey: exact-club Free and Pro entitlement transition", () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("activates, expires and revokes Pro without leaking it across clubs", async () => {
    const subscriptions = await service.from("club_subscriptions").insert([
      { club_id: fixture.clubA, plan: "starter", is_pro: false },
      { club_id: fixture.clubB, plan: "starter", is_pro: false },
    ]);
    expect(subscriptions.error).toBeNull();

    const [freeClub, freeTeam, freeUser] = await Promise.all([
      fixture.memberA.client.rpc("has_active_pro_for_club", { _club_id: fixture.clubA }),
      fixture.memberA.client.rpc("has_active_pro_for_team", { _team_id: fixture.teamA }),
      fixture.memberA.client.rpc("user_has_any_club_pro", { _user_id: fixture.memberA.id }),
    ]);
    expect(freeClub.data).toBe(false);
    expect(freeTeam.data).toBe(false);
    expect(freeUser.data).toBe(false);

    const upgraded = await service.from("club_subscriptions").update({
      plan: "standard",
      is_pro: true,
      expires_at: "2099-12-31T23:59:59.000Z",
    }).eq("club_id", fixture.clubA);
    expect(upgraded.error).toBeNull();

    const [proClub, proTeam, proUser, otherClub] = await Promise.all([
      fixture.memberA.client.rpc("has_active_pro_for_club", { _club_id: fixture.clubA }),
      fixture.memberA.client.rpc("has_active_pro_for_team", { _team_id: fixture.teamA }),
      fixture.memberA.client.rpc("user_has_any_club_pro", { _user_id: fixture.memberA.id }),
      fixture.memberA.client.rpc("has_active_pro_for_club", { _club_id: fixture.clubB }),
    ]);
    expect(proClub.data).toBe(true);
    expect(proTeam.data).toBe(true);
    expect(proUser.data).toBe(true);
    expect(otherClub.data).toBe(false);

    const expired = await service.from("club_subscriptions").update({
      expires_at: "2000-01-01T00:00:00.000Z",
    }).eq("club_id", fixture.clubA);
    expect(expired.error).toBeNull();
    const expiredAccess = await fixture.memberA.client.rpc("has_active_pro_for_team", { _team_id: fixture.teamA });
    expect(expiredAccess.data).toBe(false);

    const override = await service.from("club_subscriptions").update({
      is_pro: false,
      admin_pro_override: true,
      expires_at: "2099-12-31T23:59:59.000Z",
    }).eq("club_id", fixture.clubA);
    expect(override.error).toBeNull();
    const overriddenAccess = await fixture.memberA.client.rpc("has_active_pro_for_team", { _team_id: fixture.teamA });
    expect(overriddenAccess.data).toBe(true);

    const membershipRemoved = await fixture.adminA.client.from("user_roles").delete()
      .eq("user_id", fixture.memberA.id).eq("team_id", fixture.teamA).select("id");
    expect(membershipRemoved.error).toBeNull();
    expect(membershipRemoved.data).toHaveLength(1);

    const [clubStillPro, removedUserPro] = await Promise.all([
      fixture.adminA.client.rpc("has_active_pro_for_club", { _club_id: fixture.clubA }),
      fixture.memberA.client.rpc("user_has_any_club_pro", { _user_id: fixture.memberA.id }),
    ]);
    expect(clubStillPro.data).toBe(true);
    expect(removedUserPro.data).toBe(false);
  });
});
