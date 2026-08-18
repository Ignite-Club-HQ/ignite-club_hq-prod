import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local RLS: Free and Pro entitlement isolation", () => {
  let fixture: SecurityFixture;
  beforeAll(async () => {
    await assertSyntheticLocalMarker(); fixture = await createSecurityFixture();
    const inserted = await service.from("club_subscriptions").insert([
      { club_id: fixture.clubA, is_pro: false },
      { club_id: fixture.clubB, is_pro: true, expires_at: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    if (inserted.error) throw inserted.error;
  });
  afterAll(async () => { await fixture?.cleanup(); });

  it("denies Pro for the member's Free club", async () => {
    const result = await fixture.memberA.client.rpc("has_active_pro_for_club", { _club_id: fixture.clubA });
    expect(result).toMatchObject({ data: false, error: null });
  });

  it("does not borrow Pro from an unrelated club", async () => {
    const result = await fixture.memberA.client.rpc("user_has_any_club_pro", { _user_id: fixture.memberA.id });
    expect(result).toMatchObject({ data: false, error: null });
  });

  it("grants Pro only to a member of the entitled club", async () => {
    const result = await fixture.outsiderB.client.rpc("user_has_any_club_pro", { _user_id: fixture.outsiderB.id });
    expect(result).toMatchObject({ data: true, error: null });
  });

  it("prevents an authenticated club member altering subscription state", async () => {
    const result = await fixture.memberA.client.from("club_subscriptions").update({ is_pro: true }).eq("club_id", fixture.clubA).select("id");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});
