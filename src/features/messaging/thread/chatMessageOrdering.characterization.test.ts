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

      expect(source).toContain(
        'import { orderChatMessagesChronologically } from "@/features/messaging/thread/chatMessageOrdering"',
      );
      expect(source).toContain("orderChatMessagesChronologically(msgList)");
      expect(source).toContain("reconcileMessages(reconcileScope, sorted)");
    },
  );
});
