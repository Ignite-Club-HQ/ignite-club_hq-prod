/**
 * CHARACTERIZATION TESTS — event notification fan-out.
 *
 * These lock in the *existing* audience-resolution and notification/push
 * payload behaviour before the durable push-delivery-queue rework. They
 * must pass unchanged before AND after that change.
 *
 * Run: deno test --allow-net --allow-env supabase/functions/process-event-notifications
 */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveRecipients } from "./recipients.ts";
import { buildUpdateMessage } from "./messages.ts";
import {
  batchInsertNotifications,
  buildNotificationRows,
  buildPushPayload,
} from "./fanout.ts";
import { FakeSupabase } from "./testFakeSupabase.ts";

const CLUB = "club-1";
const TEAM = "team-a";
const OTHER_TEAM = "team-b";
const CREATOR = "user-creator";
const EVENT = "event-1";

function sorted(a: string[]) {
  return [...a].sort();
}

function teamRoles(rows: Array<[string, string, string | null]>) {
  // [user_id, role, team_id]
  return rows.map(([user_id, role, team_id]) => ({
    user_id,
    role,
    team_id,
    club_id: CLUB,
  }));
}

Deno.test("team event: exact member set, creator excluded, roles deduped", async () => {
  const db = new FakeSupabase({
    user_roles: teamRoles([
      ["u1", "player", TEAM],
      ["u2", "parent", TEAM],
      ["u2", "coach", TEAM], // multi-role must dedupe to one recipient
      [CREATOR, "team_admin", TEAM], // creator excluded
      ["u9", "player", OTHER_TEAM], // other team excluded
      ["u10", "club_admin", null], // club-level member excluded from team events
    ]),
    events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: null }],
  });

  const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
  assertEquals(sorted(ids), ["u1", "u2"]);
  // Team events must never read the events table (no restricted-role lookup).
  assertEquals(db.queries.some((q) => q.table === "events"), false);
});

Deno.test("team event: recipient counts around the old 20-batch boundary are complete", async () => {
  for (const n of [19, 20, 21, 30, 31, 200, 501]) {
    const rows = Array.from({ length: n }, (_, i) => [`u${String(i).padStart(4, "0")}`, "player", TEAM] as [string, string, string]);
    const db = new FakeSupabase({ user_roles: teamRoles(rows) });
    const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
    assertEquals(ids.length, n, `expected ${n} recipients`);
    assertEquals(new Set(ids).size, n);
  }
});

Deno.test("team event: pagination requests deterministic ordered pages", async () => {
  const rows = Array.from({ length: 450 }, (_, i) => [`u${String(i).padStart(4, "0")}`, "player", TEAM] as [string, string, string]);
  const db = new FakeSupabase({ user_roles: teamRoles(rows) });
  const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
  assertEquals(ids.length, 450);
  const ranges = db.queries.filter((q) => q.table === "user_roles").map((q) => q.range);
  assertEquals(ranges, [[0, 199], [200, 399], [400, 599]]);
  assertEquals(db.queries.every((q) => q.order === "user_id"), true);
});

Deno.test("mini-league event: league members + league admins only", async () => {
  const db = new FakeSupabase({
    mini_league_players: [
      { mini_league_id: "ml-1", parent_user_id: "p1" },
      { mini_league_id: "ml-1", parent_user_id: null },
      { mini_league_id: "ml-2", parent_user_id: "other" },
    ],
    mini_league_admins: [{ mini_league_id: "ml-1", user_id: "a1" }],
    user_roles: [
      { user_id: "la1", role: "league_admin", club_id: CLUB, team_id: null },
      { user_id: "ca1", role: "club_admin", club_id: CLUB, team_id: null },
      { user_id: CREATOR, role: "league_admin", club_id: CLUB, team_id: null },
    ],
  });
  const ids = await resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR);
  assertEquals(sorted(ids), ["a1", "la1", "p1"]);
});

Deno.test("club-wide event: all club members except creator", async () => {
  const db = new FakeSupabase({
    user_roles: teamRoles([
      ["u1", "player", TEAM],
      ["u2", "club_admin", null],
      [CREATOR, "club_admin", null],
    ]),
    events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: null }],
  });
  const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
  assertEquals(sorted(ids), ["u1", "u2"]);
});

Deno.test("club-wide event: restricted_to_roles limits audience to those roles + club_admin", async () => {
  const db = new FakeSupabase({
    user_roles: teamRoles([
      ["coach1", "coach", TEAM],
      ["player1", "player", TEAM],
      ["admin1", "club_admin", null],
      ["parent1", "parent", TEAM],
    ]),
    events: [{ id: EVENT, restricted_to_roles: ["coach"], target_team_ids: null }],
  });
  const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
  assertEquals(sorted(ids), ["admin1", "coach1"]);
});

Deno.test("targeted club-wide event: targeted teams + club admins + guardians only", async () => {
  const db = new FakeSupabase({
    user_roles: teamRoles([
      ["t1u1", "player", TEAM],
      ["t2u1", "coach", OTHER_TEAM],
      ["untargeted", "player", "team-c"],
      ["admin1", "club_admin", null],
      ["cm1", "committee_member", null],
      ["coachclub", "coach", null],
      [CREATOR, "club_admin", null],
    ]),
    child_team_assignments: [
      { team_id: TEAM, child_id: "child-1" },
      { team_id: "team-c", child_id: "child-9" },
    ],
    child_guardians: [
      { child_id: "child-1", guardian_id: "guardian-1" },
      { child_id: "child-9", guardian_id: "guardian-9" },
    ],
    events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM, OTHER_TEAM] }],
  });
  const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
  assertEquals(sorted(ids), ["admin1", "cm1", "guardian-1", "t1u1", "t2u1"]);
});

Deno.test("notification rows: exact shape, one per recipient, skip_push true", () => {
  const rows = buildNotificationRows(["u1", "u2"], "event_invite", "You've been invited to: Carnival", EVENT);
  assertEquals(rows, [
    { user_id: "u1", type: "event_invite", message: "You've been invited to: Carnival", related_id: EVENT, skip_push: true },
    { user_id: "u2", type: "event_invite", message: "You've been invited to: Carnival", related_id: EVENT, skip_push: true },
  ]);
});

Deno.test("notification insert: 200 recipients -> 200 rows, no RSVP rows created", async () => {
  const db = new FakeSupabase({ notifications: [] });
  const recipients = Array.from({ length: 200 }, (_, i) => `u${i}`);
  const { inserted, ids } = await batchInsertNotifications(db, recipients, "event_invite", "msg", EVENT);
  assertEquals(inserted, 200);
  assertEquals(ids.length, 200);
  assertEquals(new Set(ids.map((i) => i.id)).size, 200);
  assertEquals(db.inserts.every((i) => i.table === "notifications"), true);
  assertEquals(db.tables.rsvps, undefined);
});

Deno.test("notification insert: batches of 500", async () => {
  const db = new FakeSupabase({ notifications: [] });
  const recipients = Array.from({ length: 1100 }, (_, i) => `u${i}`);
  const { inserted } = await batchInsertNotifications(db, recipients, "event_invite", "msg", EVENT);
  assertEquals(inserted, 1100);
  assertEquals(db.inserts.map((i) => i.rows.length), [500, 500, 100]);
  assertEquals(db.inserts[0].options, { onConflict: "id", ignoreDuplicates: true });
});

Deno.test("push payload: exact shape and tag format", () => {
  assertEquals(
    buildPushPayload({
      userId: "u1",
      body: "You've been invited to: Carnival",
      url: `/events/${EVENT}`,
      notificationId: "notif-1",
      notificationType: "event_invite",
    }),
    {
      userId: "u1",
      title: "Ignite",
      body: "You've been invited to: Carnival",
      url: `/events/${EVENT}`,
      notificationId: "notif-1",
      tag: "event_invite-notif-1",
      notificationType: "event_invite",
    },
  );
});

Deno.test("update message wording is unchanged", () => {
  assertEquals(
    buildUpdateMessage("Carnival", [{ field: "start_time", old: null, new: null }]),
    "📅 Carnival updated: new kick-off time",
  );
  assertEquals(
    buildUpdateMessage("Carnival", [
      { field: "date", old: null, new: null },
      { field: "location", old: null, new: null },
      { field: "address", old: null, new: null },
    ]),
    "📅 Carnival updated: date, venue & address changed",
  );
  // duplicate fields dedupe
  assertEquals(
    buildUpdateMessage("Carnival", [
      { field: "title", old: null, new: null },
      { field: "title", old: null, new: null },
    ]),
    "📅 Carnival updated: new title",
  );
});
