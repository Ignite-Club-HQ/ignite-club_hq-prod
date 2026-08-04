import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/ClubAdminChatPage.tsx"),
  "utf8",
);

describe("Club Admin cache hydration boundary", () => {
  it("merges notification cache rows while retaining legacy snapshot shapes", () => {
    expect(source).toContain("mergeCachedChatMessagesChronologically(");
    expect(source).toContain("prevMessages,");
    expect(source).toContain("cached,");
    expect(source).toContain(
      "return Array.isArray(prev) ? merged : { ...prev, messages: merged, fromCache: true }",
    );
  });

  it("retains bounded recovery and does not invent older-page pagination", () => {
    expect(source).toContain("const recoveryAttemptRef = useRef(0)");
    expect(source).toContain("hasOlderMessages={false}");
    expect(source).toContain("onLoadOlder={() => {}}");
  });
});

describe("history-window placeholder selection", () => {
  it.each(["TeamChatPage.tsx", "ClubChatPage.tsx", "GroupChatPage.tsx"])(
    "%s delegates only the cache/previous/none decision",
    (name) => {
      const pageSource = readFileSync(
        resolve(process.cwd(), "src/pages", name),
        "utf8",
      );

      expect(pageSource).toContain("selectHistoryChatPlaceholderSource({");
      expect(pageSource).toContain("cachedMessageCount:");
      expect(pageSource).toContain("openedFromNotification:");
      expect(pageSource).toContain('if (placeholderSource === "previous") return prev');
      expect(pageSource).toContain('if (placeholderSource === "none") return undefined');
    },
  );
});
