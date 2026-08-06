import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
const controller = () =>
  readFileSync(resolve(process.cwd(), "src/hooks/useChatComposerController.ts"), "utf8");

describe("chat composer edit consumption", () => {
  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "DirectMessagePage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
  ])("%s shares the edit payload and state transitions", (name) => {
    const source = page(name);
    expect(source).toContain("buildChatMessageEdit(editingMessage, message)");
    expect(source).toContain("useChatComposerController");
    expect(source).toContain("beginEdit");
    expect(source).toContain("cancelEdit");
    expect(source).not.toContain("update({ text: message.trim() })");
  });

  it("keeps the shared edit transitions inside the composer controller", () => {
    const source = controller();
    expect(source).toContain("beginChatMessageEdit(message)");
    expect(source).toContain("cancelChatMessageEdit()");
  });

  it("keeps Group Chat's focus behavior local", () => {
    const source = page("GroupChatPage.tsx");
    expect(source).toContain("inputRef.current?.focus()");
  });

  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "DirectMessagePage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
  ])("keeps %s on the controller's reply-clearing edit default", (name) => {
    expect(page(name)).not.toContain("clearReplyOnEdit: false");
  });

  it("preserves Group Chat's distinct reply-on-edit behavior explicitly", () => {
    expect(page("GroupChatPage.tsx")).toContain("clearReplyOnEdit: false");
  });
});
