import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, tableData } = vi.hoisted(() => ({
  from: vi.fn(),
  tableData: new Map<string, unknown[] | { data: unknown[]; error: unknown }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { filterClubScopedNotifications } from "./filterClubScopedNotifications";

function queryFor(table: string) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => {
      const configured = tableData.get(table);
      const result = configured && !Array.isArray(configured)
        ? configured
        : { data: configured ?? [], error: null };
      return Promise.resolve(result).then(resolve);
    },
  });
  return chain;
}

const row = (id: string, type: string, relatedId: string | null, clubId?: string | null) => ({
  id,
  type,
  related_id: relatedId,
  club_id: clubId,
});

describe("filterClubScopedNotifications", () => {
  beforeEach(() => {
    tableData.clear();
    from.mockImplementation((table: string) => queryFor(table));
    vi.clearAllMocks();
  });

  it("keeps active-club and global rows while dropping explicitly foreign-club rows without lookups", async () => {
    const rows = [
      row("active", "event_invite", "event-1", "club-a"),
      row("foreign", "event_invite", "event-2", "club-b"),
      row("global", "system_update", null, null),
      row("unknown", "new_global_type", null, null),
    ];

    await expect(filterClubScopedNotifications(rows, "user-1", "club-a")).resolves.toEqual([
      rows[0], rows[2], rows[3],
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it("resolves event notifications directly by club and through their team", async () => {
    tableData.set("events", [
      { id: "event-active", club_id: "club-a", team_id: null },
      { id: "event-team-active", club_id: null, team_id: "team-a" },
      { id: "event-foreign", club_id: "club-b", team_id: null },
    ]);
    tableData.set("teams", [{ id: "team-a", club_id: "club-a" }]);
    const rows = [
      row("a", "event_invite", "event-active", null),
      row("team-a", "formation_change", "event-team-active", null),
      row("b", "game_finished", "event-foreign", null),
    ];

    await expect(filterClubScopedNotifications(rows, "user-1", "club-a")).resolves.toEqual([rows[0], rows[1]]);
    expect(from).toHaveBeenCalledWith("events");
    expect(from).toHaveBeenCalledWith("teams");
  });

  it("filters team, club, and group chat notifications by their owning club", async () => {
    tableData.set("team_messages", [
      { id: "team-msg-a", team_id: "team-a" },
      { id: "team-msg-b", team_id: "team-b" },
    ]);
    tableData.set("club_messages", [
      { id: "club-msg-a", club_id: "club-a" },
      { id: "club-msg-b", club_id: "club-b" },
    ]);
    tableData.set("group_messages", [
      { id: "group-msg-a", group_id: "group-a" },
      { id: "group-msg-b", group_id: "group-b" },
    ]);
    tableData.set("teams", [
      { id: "team-a", club_id: "club-a" },
      { id: "team-b", club_id: "club-b" },
    ]);
    tableData.set("chat_groups", [
      { id: "group-a", club_id: null, team_id: "team-a" },
      { id: "group-b", club_id: "club-b", team_id: null },
    ]);
    const rows = [
      row("ta", "team_message", "team-msg-a", null),
      row("tb", "message_reply", "team-msg-b", null),
      row("ca", "club_message", "club-msg-a", null),
      row("cb", "club_message", "club-msg-b", null),
      row("ga", "group_message", "group-msg-a", null),
      row("gb", "group_message", "group-msg-b", null),
    ];

    await expect(filterClubScopedNotifications(rows, "user-1", "club-a")).resolves.toEqual([rows[0], rows[2], rows[4]]);
  });

  it("resolves comment notifications through photos, including team-owned photos", async () => {
    tableData.set("photo_comments", [
      { id: "comment-a", photo_id: "photo-a" },
      { id: "comment-team-a", photo_id: "photo-team-a" },
      { id: "comment-b", photo_id: "photo-b" },
    ]);
    tableData.set("photos", [
      { id: "photo-a", club_id: "club-a", team_id: null },
      { id: "photo-team-a", club_id: null, team_id: "team-a" },
      { id: "photo-b", club_id: "club-b", team_id: null },
    ]);
    tableData.set("teams", [{ id: "team-a", club_id: "club-a" }]);
    const rows = [
      row("a", "photo_comment", "comment-a", null),
      row("team-a", "comment_reply", "comment-team-a", null),
      row("b", "comment_reaction", "comment-b", null),
    ];

    await expect(filterClubScopedNotifications(rows, "user-1", "club-a")).resolves.toEqual([rows[0], rows[1]]);
  });

  it("keeps direct messages only when the sender shares the active club", async () => {
    tableData.set("direct_messages", [
      { id: "dm-a", author_id: "sender-a" },
      { id: "dm-b", author_id: "sender-b" },
    ]);
    tableData.set("user_roles", [{ user_id: "sender-a" }]);
    const rows = [
      row("a", "direct_message", "dm-a", null),
      row("b", "direct_message", "dm-b", null),
    ];

    await expect(filterClubScopedNotifications(rows, "recipient", "club-a")).resolves.toEqual([rows[0]]);
  });

  it("keeps unresolved and unknown notification types instead of hiding potentially global notifications", async () => {
    tableData.set("events", []);
    const rows = [
      row("missing-event", "event_updated", "deleted-event", null),
      row("unknown", "future_notification", "future-id", null),
    ];

    await expect(filterClubScopedNotifications(rows, "user-1", "club-a")).resolves.toEqual(rows);
  });

  it("must not expose a known club-scoped notification when ownership lookup fails", async () => {
    tableData.set("events", {
      data: [],
      error: { message: "event ownership lookup denied" },
    });
    const scoped = row("event", "event_updated", "event-foreign", null);

    await expect(
      filterClubScopedNotifications([scoped], "user-1", "club-a"),
    ).resolves.toEqual([]);
  });
});
