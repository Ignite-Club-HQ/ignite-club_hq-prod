import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
const controller = () =>
  readFileSync(resolve(process.cwd(), "src/hooks/useChatComposerController.ts"), "utf8");

describe("chat composer intent consumption", () => {
  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
  ])("%s shares content eligibility and poll text construction", (name) => {
    const source = page(name);
    expect(source).toContain("useChatComposerController");
    expect(source).toContain("canSend");
    expect(source).toContain("buildSubmission");
    expect(source).not.toContain("`[poll:${pendingPollId}]`");
  });

  it("keeps eligibility and poll text construction centralized in the controller", () => {
    const source = controller();
    expect(source).toContain("hasChatComposerContent({ text, imageUrl, pendingPollId })");
    expect(source).toContain("buildChatComposerText(text, pendingPollId)");
  });

  it("DirectMessagePage shares content eligibility but retains its distinct permission flow", () => {
    const source = page("DirectMessagePage.tsx");
    expect(source).toContain("useChatComposerController");
    expect(source).toContain("canSend");
    expect(source).toContain("canDM === false && !checkingCanDM");
    expect(source).toContain("buildSubmission");
  });
});
