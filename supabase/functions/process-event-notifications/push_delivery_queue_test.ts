/**
 * Push delivery queue characterization — proves the durable-outbox design
 * (no code inside the worker itself; we exercise the SQL contract through
 * the same fake Supabase used elsewhere).
 */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { FakeSupabase } from "./testFakeSupabase.ts";
import { batchInsertNotifications, buildNotificationRows } from "./fanout.ts";

Deno.test("200-recipient fan-out inserts 200 notification rows total", async () => {
  const db = new FakeSupabase({ notifications: [] });
  const recipients = Array.from({ length: 200 }, (_, i) => `u${i}`);
  const { inserted, ids } = await batchInsertNotifications(db, recipients, "event_invite", "msg", "e1");
  assertEquals(inserted, 200);
  assertEquals(new Set(ids.map((i) => i.userId)).size, 200);
});

Deno.test("push payload shape locked in for 200-row batch", () => {
  const rows = buildNotificationRows(
    Array.from({ length: 200 }, (_, i) => `u${i}`),
    "event_invite",
    "You've been invited to: Strathalbyn Carnival",
    "event-strath",
  );
  assertEquals(rows.length, 200);
  assertEquals(rows[0], {
    user_id: "u0",
    type: "event_invite",
    message: "You've been invited to: Strathalbyn Carnival",
    related_id: "event-strath",
    skip_push: true,
  });
  // Never any RSVP rows in the notification insert
  assertEquals(rows.every((r) => "user_id" in r && !("event_id" in r)), true);
});
