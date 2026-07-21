import { describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service } from "./fixtures";

describe("local infrastructure: synthetic fixture cleanup", () => {
  it("removes clubs, memberships, profiles and Auth users created by a fixture", async () => {
    await assertSyntheticLocalMarker();
    const fixture = await createSecurityFixture();
    const userIds = [fixture.adminA.id, fixture.memberA.id, fixture.outsiderB.id];
    const clubIds = [fixture.clubA, fixture.clubB];
    await fixture.cleanup();

    const [clubs, roles, profiles] = await Promise.all([
      service.from("clubs").select("id").in("id", clubIds),
      service.from("user_roles").select("id").in("user_id", userIds),
      service.from("profiles").select("id").in("id", userIds),
    ]);
    expect(clubs.error).toBeNull(); expect(clubs.data).toEqual([]);
    expect(roles.error).toBeNull(); expect(roles.data).toEqual([]);
    expect(profiles.error).toBeNull(); expect(profiles.data).toEqual([]);
    for (const userId of userIds) {
      const authUser = await service.auth.admin.getUserById(userId);
      expect(authUser.error).not.toBeNull();
      expect(authUser.data.user).toBeNull();
    }
  });
});
