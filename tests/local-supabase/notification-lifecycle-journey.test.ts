import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local journey: notification preferences, isolation and read state", () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => fixture?.cleanup());

  it("keeps preferences and notifications private and prevents duplicate delivery records", async () => {
    const ownPreferences = await fixture.memberA.client.from("notification_preferences").insert({
      user_id: fixture.memberA.id,
      events_enabled: true,
      membership_enabled: false,
      messages_enabled: true,
    }).select("events_enabled, membership_enabled").single();
    expect(ownPreferences.error).toBeNull();
    expect(ownPreferences.data).toEqual({ events_enabled: true, membership_enabled: false });

    const cannotWriteAnotherUsersPreferences = await fixture.outsiderB.client
      .from("notification_preferences").insert({ user_id: fixture.memberA.id });
    expect(cannotWriteAnotherUsersPreferences.error).not.toBeNull();

    const hiddenPreferences = await fixture.outsiderB.client.from("notification_preferences")
      .select("user_id").eq("user_id", fixture.memberA.id);
    expect(hiddenPreferences.data).toEqual([]);

    const relatedId = crypto.randomUUID();
    const inserted = await service.from("notifications").insert([
      {
        user_id: fixture.memberA.id,
        club_id: fixture.clubA,
        type: "event",
        message: "Synthetic training changed",
        related_id: relatedId,
        skip_push: true,
      },
      {
        user_id: fixture.outsiderB.id,
        club_id: fixture.clubB,
        type: "event",
        message: "Synthetic unrelated club event",
        related_id: crypto.randomUUID(),
        skip_push: true,
      },
    ]).select("id, user_id");
    expect(inserted.error).toBeNull();
    const memberNotificationId = inserted.data!.find((row) => row.user_id === fixture.memberA.id)!.id;

    const duplicate = await service.from("notifications").insert({
      user_id: fixture.memberA.id,
      club_id: fixture.clubA,
      type: "event",
      message: "Synthetic training changed",
      related_id: relatedId,
      skip_push: true,
    });
    expect(duplicate.error?.code).toBe("23505");

    const ownInbox = await fixture.memberA.client.from("notifications")
      .select("id, club_id, is_read, skip_push").order("created_at");
    expect(ownInbox.error).toBeNull();
    expect(ownInbox.data).toEqual([{
      id: memberNotificationId,
      club_id: fixture.clubA,
      is_read: false,
      skip_push: true,
    }]);

    const outsiderCannotSeeOrMarkRead = await fixture.outsiderB.client.from("notifications")
      .update({ is_read: true }).eq("id", memberNotificationId).select("id");
    expect(outsiderCannotSeeOrMarkRead.error).toBeNull();
    expect(outsiderCannotSeeOrMarkRead.data).toEqual([]);

    const markedRead = await fixture.memberA.client.from("notifications")
      .update({ is_read: true }).eq("id", memberNotificationId).select("is_read").single();
    expect(markedRead.error).toBeNull();
    expect(markedRead.data?.is_read).toBe(true);

    const outsiderCannotDelete = await fixture.outsiderB.client.from("notifications")
      .delete().eq("id", memberNotificationId).select("id");
    expect(outsiderCannotDelete.error).toBeNull();
    expect(outsiderCannotDelete.data).toEqual([]);

    const deleted = await fixture.memberA.client.from("notifications")
      .delete().eq("id", memberNotificationId).select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([{ id: memberNotificationId }]);
  });
});
