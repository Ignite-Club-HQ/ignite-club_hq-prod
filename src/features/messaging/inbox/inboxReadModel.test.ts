import { describe, expect, it } from "vitest";
import {
  filterInboxConversations,
  normalizeInboxTypeFilter,
  partitionInboxByReadState,
  resolveOperationalConversationDisclosure,
  type InboxConversation,
  type InboxConversationType,
} from "./inboxReadModel";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function conversation(
  key: string,
  type: InboxConversationType,
  overrides: Partial<InboxConversation> = {},
): InboxConversation {
  return {
    type,
    id: key,
    key,
    name: key,
    link: `/messages/${key}`,
    lastActivity: "2026-08-04T10:00:00.000Z",
    unreadCount: 0,
    isMuted: false,
    ...overrides,
  };
}

describe("messaging inbox read model", () => {
  it("normalizes legacy and invalid persisted filter values", () => {
    expect(normalizeInboxTypeFilter("club")).toBe("groups");
    expect(normalizeInboxTypeFilter("league")).toBe("groups");
    expect(normalizeInboxTypeFilter("teams")).toBe("teams");
    expect(normalizeInboxTypeFilter("unexpected")).toBe("all");
  });

  it("maps each conversation type to the existing user-facing filter buckets", () => {
    const rows = [
      conversation("team", "team"),
      conversation("league", "league"),
      conversation("group", "group"),
      conversation("club", "club"),
      conversation("admin", "admin_group"),
      conversation("dm", "dm"),
      conversation("broadcast", "broadcast"),
      conversation("support", "support"),
    ];

    expect(filterInboxConversations(rows, "teams").map((row) => row.key)).toEqual([
      "team", "league", "support",
    ]);
    expect(filterInboxConversations(rows, "groups").map((row) => row.key)).toEqual([
      "group", "club", "admin", "support",
    ]);
    expect(filterInboxConversations(rows, "dms").map((row) => row.key)).toEqual([
      "dm", "support",
    ]);
  });

  it("partitions unread and recent rows and orders each newest-first without mutating input", () => {
    const rows = [
      conversation("recent-old", "team", { lastActivity: "2026-08-01T10:00:00.000Z" }),
      conversation("unread-new", "club", { unreadCount: 2, lastActivity: "2026-08-04T11:00:00.000Z" }),
      conversation("recent-new", "dm", { lastActivity: "2026-08-03T10:00:00.000Z" }),
      conversation("unread-no-date", "group", { unreadCount: 1, lastActivity: "" }),
    ];
    const originalOrder = rows.map((row) => row.key);

    const result = partitionInboxByReadState(rows);

    expect(result.unread.map((row) => row.key)).toEqual(["unread-new", "unread-no-date"]);
    expect(result.recent.map((row) => row.key)).toEqual(["recent-new", "recent-old"]);
    expect(rows.map((row) => row.key)).toEqual(originalOrder);
  });

  it("collapses only the stale operational long tail and keeps the first two visible", () => {
    const staleGroups = Array.from({ length: 7 }, (_, index) =>
      conversation(`stale-${index}`, index % 2 ? "league" : "group", {
        lastActivity: "2026-06-01T00:00:00.000Z",
      }),
    );
    const ordinary = conversation("ordinary-dm", "dm", { lastActivity: "2026-05-01T00:00:00.000Z" });
    const recent = conversation("recent-group", "group", { lastActivity: "2026-08-03T00:00:00.000Z" });
    const draft = conversation("draft-group", "group", {
      lastActivity: "2026-05-01T00:00:00.000Z",
      draftText: "unsent",
    });

    const result = resolveOperationalConversationDisclosure(
      [...staleGroups, ordinary, recent, draft],
      { now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: false },
    );

    expect(result.hiddenOps.map((row) => row.key)).toEqual([
      "stale-2", "stale-3", "stale-4", "stale-5", "stale-6",
    ]);
    expect(result.visibleRecent.map((row) => row.key)).toEqual([
      "stale-0", "stale-1", "ordinary-dm", "recent-group", "draft-group",
    ]);
  });

  it("does not collapse at the threshold or while disclosure is explicitly requested", () => {
    const stale = Array.from({ length: 7 }, (_, index) =>
      conversation(`stale-${index}`, "group", { lastActivity: "" }),
    );
    const six = stale.slice(0, 6);

    expect(resolveOperationalConversationDisclosure(six, {
      now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: true, typeFilter: "all", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: false, typeFilter: "groups", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: true,
    }).hiddenOps).toEqual([]);
  });
});
