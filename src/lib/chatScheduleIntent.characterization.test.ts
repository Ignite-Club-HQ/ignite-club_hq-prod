import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat scheduling intent consumption", () => {
  it.each([
    ["TeamChatPage.tsx", 'buildChatScheduleTarget("team", teamId)'],
    ["ClubChatPage.tsx", 'buildChatScheduleTarget("club", clubId)'],
    ["GroupChatPage.tsx", 'buildChatScheduleTarget("group", groupId)'],
    ["DirectMessagePage.tsx", 'buildChatScheduleTarget("direct", conversationId)'],
    ["ClubAdminChatPage.tsx", 'buildChatScheduleTarget("club_admin", conversationId)'],
    ["BroadcastChatPage.tsx", 'buildChatScheduleTarget("broadcast")'],
  ])("%s derives its exact schedule target centrally", (name, target) => {
    const source = page(name);
    expect(source).toContain(target);
    expect(source).toContain("resetChatComposerAfterSchedule({");
  });

  it("retains Direct Message attachment restrictions locally", () => {
    const source = page("DirectMessagePage.tsx");
    expect(source).toContain("!isIgniteSupportConversation && !attachmentsDisabled");
    expect(source).toContain("dm_attachments_disabled");
  });

  it("retains failed Team attachment restoration locally", () => {
    const source = page("TeamChatPage.tsx");
    expect(source).toContain("restoreAfterFailedSend(context)");
    expect(source).toContain("useChatComposerController");
  });
});
