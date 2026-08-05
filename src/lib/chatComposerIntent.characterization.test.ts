import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat composer intent consumption", () => {
  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
  ])("%s shares content eligibility and poll text construction", (name) => {
    const source = page(name);
    expect(source).toContain("hasChatComposerContent({");
    expect(source).toContain("buildChatComposerText(message, pendingPollId)");
    expect(source).not.toContain("`[poll:${pendingPollId}]`");
  });

  it("DirectMessagePage shares content eligibility but retains its distinct permission flow", () => {
    const source = page("DirectMessagePage.tsx");
    expect(source).toContain("hasChatComposerContent({ text: message, imageUrl: dmImageUrl })");
    expect(source).toContain("canDM === false && !checkingCanDM");
    expect(source).not.toContain("buildChatComposerText");
  });
});
