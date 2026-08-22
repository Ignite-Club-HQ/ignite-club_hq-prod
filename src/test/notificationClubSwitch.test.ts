/**
 * Notification taps for a different club must move the global club filter, and
 * must never guess: unresolvable or non-club-scoped targets leave it alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Record<string, any> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // Assign an Error to rows[table] to simulate a failed lookup (the
          // cold-start race: RLS rejects the query before the session restores).
          maybeSingle: async () => rows[table] instanceof Error
            ? { data: null, error: rows[table] }
            : { data: rows[table] ?? null, error: null },
        }),
      }),
    }),
  },
}));

import {
  resolveNotificationClubId,
  requestClubSwitchForNotification,
  peekPendingNotificationClubSwitch,
  peekPendingNotificationClubSwitchRequest,
  consumePendingNotificationClubSwitch,
  stashResolvedNotificationClubSwitch,
  clearPendingNotificationClubSwitch,
  isNotificationClubSwitchInFlight,
  clearNotificationClubSwitchInFlight,
} from "@/lib/notificationClubSwitch";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  clearPendingNotificationClubSwitch();
  clearNotificationClubSwitchInFlight();
});


describe("resolveNotificationClubId", () => {
  it("prefers an explicit club_id from the payload", async () => {
    const id = await resolveNotificationClubId({ type: "team_message", club_id: "club-B", team_id: "t1", message_id: "m1" }, "/messages/t1?message=m1");
    expect(id).toBe("club-B");
  });

  it("resolves a team message to its club", async () => {
    rows.teams = { club_id: "club-B" };
    const id = await resolveNotificationClubId({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    expect(id).toBe("club-B");
  });

  it("resolves a group message to its club", async () => {
    rows.chat_groups = { club_id: "club-C" };
    const id = await resolveNotificationClubId({ type: "group_message", message_id: "m1" }, "/groups/g1?message=m1");
    expect(id).toBe("club-C");
  });

  it("uses the club id directly for club messages", async () => {
    const id = await resolveNotificationClubId({ type: "club_message", message_id: "m1" }, "/messages/club/club-D?message=m1");
    expect(id).toBe("club-D");
  });

  it("returns null for DMs (not club-scoped)", async () => {
    const id = await resolveNotificationClubId({ type: "direct_message", message_id: "m1" }, "/messages/dm/c1?message=m1");
    expect(id).toBeNull();
  });

  it("returns null when a personal group has no club", async () => {
    rows.chat_groups = { club_id: null };
    const id = await resolveNotificationClubId({ type: "group_message", message_id: "m1" }, "/groups/g1?message=m1");
    expect(id).toBeNull();
  });
});

describe("requestClubSwitchForNotification", () => {
  it("stashes the resolved club for the provider to apply", async () => {
    rows.teams = { club_id: "club-B" };
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBe("club-B");
  });

  it("stashes nothing when the club can't be determined", async () => {
    requestClubSwitchForNotification({ type: "direct_message", message_id: "m1" }, "/messages/dm/c1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBeNull();
  });
});

describe("non-chat notification urls", () => {
  it("resolves an event notification to the event's club", async () => {
    rows.events = { club_id: "club-E" };
    const id = await resolveNotificationClubId({ type: "event_invite" }, "/events/ev1");
    expect(id).toBe("club-E");
  });

  it("resolves a club-scoped url directly", async () => {
    expect(await resolveNotificationClubId({ type: "club_join" }, "/clubs/club-F")).toBe("club-F");
    expect(await resolveNotificationClubId({ type: "reward_available" }, "/clubs/club-G/rewards")).toBe("club-G");
    expect(await resolveNotificationClubId({ type: "fees" }, "/pay-fees/club-H")).toBe("club-H");
  });

  it("resolves a team url to its club", async () => {
    rows.teams = { club_id: "club-I" };
    expect(await resolveNotificationClubId({ type: "team_invite" }, "/teams/t9")).toBe("club-I");
  });

  it("resolves a media photo notification via the photo row", async () => {
    rows.photos = { club_id: "club-J", team_id: null };
    expect(await resolveNotificationClubId({ type: "photo_uploaded" }, "/media?photo=p1")).toBe("club-J");
  });

  it("falls back to a payload team_id when the url is not club-scoped", async () => {
    rows.teams = { club_id: "club-K" };
    expect(await resolveNotificationClubId({ type: "pitch_board", team_id: "t3" }, "/notifications")).toBe("club-K");
  });

  it("returns null for routes that are not club-owned", async () => {
    expect(await resolveNotificationClubId({ type: "points_awarded" }, "/profile?section=points-history")).toBeNull();
  });
});

describe("in-flight switch marker", () => {
  it("is set as soon as a switch is stashed and cleared explicitly", async () => {
    rows.events = { club_id: "club-L" };
    requestClubSwitchForNotification({ type: "event_invite" }, "/events/ev2");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBe("club-L");
    expect(isNotificationClubSwitchInFlight("club-L")).toBe(true);
    expect(isNotificationClubSwitchInFlight("club-other")).toBe(false);
    clearNotificationClubSwitchInFlight();
    expect(isNotificationClubSwitchInFlight("club-L")).toBe(false);
  });
});
