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
      expect(source).toContain("orderChatMessagesChronologically(msgList)");
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
});
