import { describe, expect, it } from "vitest";
import { orderChatMessagesChronologically } from "./chatMessageOrdering";

describe("orderChatMessagesChronologically", () => {
  it("orders older messages before newer messages", () => {
    const result = orderChatMessagesChronologically([
      { id: "newer", created_at: "2026-08-04T10:01:00.000Z" },
      { id: "older", created_at: "2026-08-04T10:00:00.000Z" },
    ]);

    expect(result.map((message) => message.id)).toEqual(["older", "newer"]);
  });

  it("uses immutable message id to make equal timestamps deterministic", () => {
    const created_at = "2026-08-04T10:00:00.000Z";

    expect(
      orderChatMessagesChronologically([
        { id: "message-b", created_at },
        { id: "message-a", created_at },
      ]).map((message) => message.id),
    ).toEqual(["message-a", "message-b"]);
  });

  it("retains the existing id fallback when timestamps are invalid", () => {
    expect(
      orderChatMessagesChronologically([
        { id: "message-b", created_at: "invalid" },
        { id: "message-a", created_at: "invalid" },
      ]).map((message) => message.id),
    ).toEqual(["message-a", "message-b"]);
  });

  it("does not mutate the query-owned input array", () => {
    const messages = [
      { id: "newer", created_at: "2026-08-04T10:01:00.000Z" },
      { id: "older", created_at: "2026-08-04T10:00:00.000Z" },
    ];

    const result = orderChatMessagesChronologically(messages);

    expect(result).not.toBe(messages);
    expect(messages.map((message) => message.id)).toEqual(["newer", "older"]);
  });
});
