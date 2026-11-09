import { describe, expect, it } from "vitest";
import { isChatAccessDeniedError, resolveGroupChatAccess } from "./chatAccessState";

describe("chat access state", () => {
  it("reads the canister's membership refusal as denied access", () => {
    expect(
      resolveGroupChatAccess({
        serverDecision: null,
        chatVisible: false,
        messageReadError: new Error("Open conversation failed: Conversation access forbidden"),
      }),
    ).toBe("denied");
    expect(
      resolveGroupChatAccess({
        serverDecision: null,
        chatVisible: true,
        messageReadError: new Error("List latest messages failed: Club chat access forbidden"),
      }),
    ).toBe("denied");
  });

  it("treats the database's own refusal as denied while the chat is on screen", () => {
    expect(
      resolveGroupChatAccess({ serverDecision: false, chatVisible: true }),
    ).toBe("denied");
  });

  it("confirms access when the database says the person may read the messages", () => {
    expect(
      resolveGroupChatAccess({ serverDecision: true, chatVisible: true }),
    ).toBe("granted");
  });

  it("never denies access when the permission read could not be asked", () => {
    // The read failed / is still in flight / the chat is canister-served.
    expect(resolveGroupChatAccess({ serverDecision: null, chatVisible: true })).toBe(
      "unknown",
    );
    // A chat whose details have not arrived yet must keep its own screens.
    expect(resolveGroupChatAccess({ serverDecision: false, chatVisible: false })).toBe(
      "unknown",
    );
  });

  it("keeps unrelated failures and genuinely missing chats out of the refusal", () => {
    expect(isChatAccessDeniedError(new Error("Fetched messages returned 0 rows"))).toBe(false);
    expect(isChatAccessDeniedError(new Error("Conversation not found"))).toBe(false);
    expect(isChatAccessDeniedError(new Error("Group metadata not found"))).toBe(false);
    expect(isChatAccessDeniedError(undefined)).toBe(false);
    expect(
      resolveGroupChatAccess({
        serverDecision: null,
        chatVisible: true,
        messageReadError: new Error("Open conversation failed: Conversation not found"),
      }),
    ).toBe("unknown");
  });

  it("does not let a stale refusal leak onto a chat the person can read", () => {
    expect(
      resolveGroupChatAccess({
        serverDecision: true,
        chatVisible: true,
        messageReadError: new Error("Open conversation failed: Conversation access forbidden"),
      }),
    ).toBe("denied");
  });
});
