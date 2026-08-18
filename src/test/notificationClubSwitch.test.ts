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
          maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        }),
      }),
    }),
  },
}));

import {
  resolveNotificationClubId,
  requestClubSwitchForNotification,
  peekPendingNotificationClubSwitch,
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
