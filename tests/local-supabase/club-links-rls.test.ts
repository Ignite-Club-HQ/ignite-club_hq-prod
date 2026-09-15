import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local RLS: club link isolation", () => {
  let fixture: SecurityFixture;
  let activeLinkId: string;
  let inactiveLinkId: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    const inserted = await service.from("club_links").insert([
      { club_id: fixture.clubA, title: "Synthetic active link", url: "https://local.invalid/active", is_active: true },
      { club_id: fixture.clubA, title: "Synthetic inactive link", url: "https://local.invalid/inactive", is_active: false },
      { club_id: fixture.clubB, title: "Synthetic other-club link", url: "https://local.invalid/other", is_active: true },
    ]).select("id, title");
    if (inserted.error) throw inserted.error;
    activeLinkId = inserted.data.find((row) => row.title === "Synthetic active link")!.id;
    inactiveLinkId = inserted.data.find((row) => row.title === "Synthetic inactive link")!.id;
  });

  afterAll(async () => { await fixture?.cleanup(); });

  it("lets a club member read active links only in their club", async () => {
    const result = await fixture.memberA.client.from("club_links").select("id, title");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: activeLinkId, title: "Synthetic active link" }]);
  });

  it("lets a club administrator read inactive links in their club", async () => {
    const result = await fixture.adminA.client.from("club_links").select("id").eq("id", inactiveLinkId);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: inactiveLinkId }]);
  });

  it("does not expose another club's links", async () => {
    const result = await fixture.memberA.client.from("club_links").select("title").eq("club_id", fixture.clubB);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("prevents an ordinary member creating club links", async () => {
    const result = await fixture.memberA.client.from("club_links").insert({
      club_id: fixture.clubA,
      title: "Unauthorized link",
      url: "https://local.invalid/unauthorized",
    });
    expect(result.error).not.toBeNull();
  });

  it("lets the club administrator create and update a link in their club", async () => {
    const created = await fixture.adminA.client.from("club_links").insert({
      club_id: fixture.clubA,
      title: "Administrator link",
      url: "https://local.invalid/admin",
    }).select("id").single();
    expect(created.error).toBeNull();

    const updated = await fixture.adminA.client.from("club_links")
      .update({ title: "Updated administrator link" })
      .eq("id", created.data!.id)
      .select("title").single();
    expect(updated.error).toBeNull();
    expect(updated.data?.title).toBe("Updated administrator link");
  });

  it("prevents a club administrator mutating another club's link", async () => {
    const result = await fixture.adminA.client.from("club_links")
      .update({ title: "Cross-club mutation" })
      .eq("club_id", fixture.clubB)
      .select("id");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});
