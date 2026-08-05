import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

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
    expect(source).toContain("beginChatMessageEdit(msg)");
    expect(source).toContain("cancelChatMessageEdit()");
    expect(source).not.toContain("update({ text: message.trim() })");
  });

  it("keeps Group Chat's focus behavior local", () => {
    const source = page("GroupChatPage.tsx");
    expect(source).toContain("inputRef.current?.focus()");
  });

  it.each([
    ["TeamChatPage.tsx", "setReplyingTo(null)"],
    ["ClubChatPage.tsx", "setReplyingTo(null)"],
    ["DirectMessagePage.tsx", "setReplyTo(null)"],
    ["ClubAdminChatPage.tsx", "setReplyTo(null)"],
    ["BroadcastChatPage.tsx", "setReplyingTo(null)"],
  ])("keeps %s reply cancellation local", (name, cancellation) => {
    expect(page(name)).toContain(cancellation);
  });
});
