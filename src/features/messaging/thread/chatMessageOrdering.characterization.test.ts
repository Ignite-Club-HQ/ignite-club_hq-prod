import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat chronological-order boundary consumption", () => {
  it.each([
    "BroadcastChatPage.tsx",
    "DirectMessagePage.tsx",
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "ClubAdminChatPage.tsx",
  ])(
    "%s prepares query messages for Realtime reconciliation with the shared ordering rule",
    (name) => {
      const source = page(name);

      expect(source).toContain("orderChatMessagesChronologically");
      expect(source).toContain(
        'from "@/features/messaging/thread/chatMessageOrdering"',
      );
      // The security-scoping boundary may intentionally rename/filter the
      // input before ordering it. Protect consumption of the shared rule,
      // rather than coupling this test to a local variable name.
      expect(source).toMatch(/orderChatMessagesChronologically\([^)]*\)/);
      expect(source).toContain("reconcileMessages(reconcileScope, sorted)");
    },
  );

  it("Team preserves current state when an older page repeats a boundary message", () => {
    const source = page("TeamChatPage.tsx");

    expect(source).toContain("mergeOlderChatMessagesChronologically(");
    expect(source).toContain("olderMessages,");
    expect(source).toContain("existing,");
    expect(source).toContain("reconcileMessages(reconcileScope, sorted)");
  });

  it("Group merges older messages without moving its separate reaction-array contract", () => {
    const source = page("GroupChatPage.tsx");

    expect(source).toContain("mergeOlderChatMessagesChronologically(");
    expect(source).toContain("enrichedOlderMessages,");
    expect(source).toContain("old.messages,");
    expect(source).toContain(
      "reactions: [...(reactionsData as MessageReaction[]), ...(old.reactions || [])]",
    );
  });

  it.each(["ClubChatPage.tsx", "BroadcastChatPage.tsx"])(
    "%s preserves its strict-timestamp prepend contract",
    (name) => {
      const source = page(name);

      expect(source).toContain('.lt("created_at", oldestMessage.created_at)');
      expect(source).toContain("prependStrictlyOlderChatMessages(");
      expect(source).toContain("olderMessages,");
      expect(source).toContain("existingMessages,");
    },
  );

  it("Direct Message preserves its strict prepend before persisting the merged cache", () => {
    const source = page("DirectMessagePage.tsx");
    const merge = source.indexOf("const merged = prependStrictlyOlderChatMessages(");
    const persist = source.indexOf("cacheDirectMessages(conversationId, merged)", merge);

    expect(source).toContain('.lt("created_at", oldestMessage.created_at)');
    expect(merge).toBeGreaterThan(-1);
    expect(source.slice(merge, persist)).toContain("reconciledOlder,");
    expect(source.slice(merge, persist)).toContain("existing,");
    expect(persist).toBeGreaterThan(merge);
  });
});
