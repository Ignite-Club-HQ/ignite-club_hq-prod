import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const surfaces = [
  ["TeamChatPage.tsx", "team_messages", "team-messages"],
  ["ClubChatPage.tsx", "club_messages", "club-messages"],
  ["GroupChatPage.tsx", "group_messages", "group-messages"],
  ["DirectMessagePage.tsx", "direct_messages", "dm-messages"],
  ["BroadcastChatPage.tsx", "broadcast_messages", "broadcast-messages"],
  ["ClubAdminChatPage.tsx", "club_admin_messages", "club-admin-messages"],
] as const;
const page = (name: string) => readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("six-surface messaging refactor contracts", () => {
  for (const [name, table, cachePrefix] of surfaces) {
    it(`${name} retains fetch, soft-delete filtering and stable chronological ordering`, () => {
      const text = page(name);
      expect(text).toContain(`from(\"${table}\")`);
      expect(text).toContain('.is("deleted_at", null)');
      expect(text).toContain('.order("created_at"');
    });

    it(`${name} retains optimistic send, offline queueing and draft clearing`, () => {
      const text = page(name);
      expect(text).toContain("queueMessage(");
      expect(text).toMatch(/temp-|optimisticMessage/);
      expect(text).toContain("clearDraft");
      expect(text).toContain("reply_to_id");
      if (["BroadcastChatPage.tsx", "DirectMessagePage.tsx", "ClubAdminChatPage.tsx", "ClubChatPage.tsx", "TeamChatPage.tsx", "GroupChatPage.tsx"].includes(name)) {
        expect(text).toContain("useChatComposerController");
        expect(text).toContain("resetAfterSend()");
      } else {
        expect(text).toContain("resetChatComposerAfterSend({");
      }
    });

    it(`${name} reconciles Realtime insert, update and delete before subscribing`, () => {
      const text = page(name);
      for (const event of ["INSERT", "UPDATE", "DELETE"]) expect(text).toContain(`event: \"${event}\"`);
      expect(text).toContain(`table: \"${table}\"`);
      expect(text.indexOf(`table: \"${table}\"`)).toBeLessThan(text.indexOf(".subscribe("));
    });

    it(`${name} reconciles all reaction lifecycle events`, () => {
      const text = page(name);
      expect((text.match(/table: \"message_reactions\"/g) || []).length).toBeGreaterThanOrEqual(3);
      expect(text).toMatch(/temp-.*reaction|reaction.*temp-/s);
    });

    it(`${name} keeps remote history search, abort support and exact-message jumping`, () => {
      const text = page(name);
      expect(text).toContain("searchChatHistory({");
      expect(text).toContain("signal");
      expect(text).toContain("jumpToMessageInVirtualizedChat");
      expect(text).toContain("tryLoadOlder");
    });

    it(`${name} isolates its query cache scope`, () => {
      const text = page(name);
      if (name === "ClubAdminChatPage.tsx") {
        expect(text).toContain("CLUB_ADMIN_CHAT_SCOPE.cachePrefix");
      } else if (name === "DirectMessagePage.tsx") {
        expect(text).toContain("DIRECT_CHAT_SCOPE.cachePrefix");
      } else if (name === "GroupChatPage.tsx") {
        expect(text).toContain("GROUP_CHAT_SCOPE.cachePrefix");
      } else if (name === "ClubChatPage.tsx") {
        expect(text).toContain("CLUB_CHAT_SCOPE.cachePrefix");
      } else if (name === "TeamChatPage.tsx") {
        expect(text).toContain("TEAM_CHAT_SCOPE.cachePrefix");
      } else {
        expect(text).toContain(cachePrefix);
      }
      expect(text).toContain("queryClient.setQueryData");
    });

    it(`${name} preserves composer, mentions, replies, edit state and keyboard locking`, () => {
      const text = page(name);
      expect(text).toContain("MentionInput");
      expect(text).toMatch(/replyingTo|replyTo/);
      expect(text).toContain("editingMessage");
      expect(text).toContain("<ChatPageFrame");
      expect(text).toContain("height={chatHeight}");
      expect(text).toContain("onTouchStart={swipeBack.onTouchStart}");
      expect(text).toContain("onTouchEnd={swipeBack.onTouchEnd}");
      expect(text).toContain("scrollToBottom");
    });
  }

  it("keeps shared header search composition on the five standard chat surfaces", () => {
    for (const name of [
      "TeamChatPage.tsx",
      "ClubChatPage.tsx",
      "GroupChatPage.tsx",
      "DirectMessagePage.tsx",
      "BroadcastChatPage.tsx",
    ]) {
      const text = page(name);
      expect(text).toContain("<ChatHeaderShell");
      expect(text).toContain("search={{");
    }

    const clubAdmin = page("ClubAdminChatPage.tsx");
    expect(clubAdmin).not.toContain("<ChatHeaderShell");
    expect(clubAdmin).toContain("<ChatSearchBar");
  });

  it("preserves Group Chat's distinct top-level reaction merge", () => {
    const text = page("GroupChatPage.tsx");
    expect(text).toContain("top-level reactions");
    expect(text).toContain("reactionsByMessage");
  });

  it("preserves Team Chat announcement and system-message fields", () => {
    const text = page("TeamChatPage.tsx");
    expect(text).toContain("is_club_announcement");
    expect(text).toContain("club_announcement_name");
    expect(text).toContain("is_system_message");
  });

  it("preserves Group forwarding policy", () => {
    expect(page("GroupChatPage.tsx")).toContain("allow_forwarding");
  });

  it("preserves DM support-conversation restrictions", () => {
    expect(page("DirectMessagePage.tsx")).toContain("isIgniteSupportConversation");
  });

  it("preserves app-admin authorization for Broadcast sending", () => {
    const text = page("BroadcastChatPage.tsx");
    expect(text).toContain('useIsAppAdmin');
    expect(text).toContain('const { isAppAdmin } = useIsAppAdmin()');
  });
});
