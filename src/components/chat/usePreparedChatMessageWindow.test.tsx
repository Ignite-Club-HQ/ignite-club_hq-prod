import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchChatImageAspectRatio } from "@/lib/chatImageAspectCache";
import {
  getChatMessageImageUrl,
  prepareChatMessageWindow,
  usePreparedChatMessageWindow,
} from "./usePreparedChatMessageWindow";

vi.mock("@/lib/chatImageAspectCache", () => ({
  prefetchChatImageAspectRatio: vi.fn(),
}));

const prefetchMock = vi.mocked(prefetchChatImageAspectRatio);

beforeEach(() => prefetchMock.mockReset());

describe("prepareChatMessageWindow", () => {
  it("keeps the first occurrence and builds indices against the unique window", () => {
    const first = { id: "message-1", body: "authoritative first row" };
    const result = prepareChatMessageWindow([
      first,
      { id: "message-2", body: "second row" },
      { id: "message-1", body: "pagination duplicate" },
    ]);

    expect(result.uniqueMessages).toEqual([first, { id: "message-2", body: "second row" }]);
    expect([...result.indexById]).toEqual([["message-1", 0], ["message-2", 1]]);
    expect([...result.duplicateCounts]).toEqual([["message-1", 2]]);
  });

  it("counts every colliding occurrence without disturbing later unique rows", () => {
    const result = prepareChatMessageWindow([
      { id: "a" }, { id: "a" }, { id: "b" }, { id: "a" }, { id: "c" },
    ]);

    expect(result.uniqueMessages.map((message) => message.id)).toEqual(["a", "b", "c"]);
    expect(result.duplicateCounts.get("a")).toBe(3);
  });

  it("returns stable empty collections for an empty window", () => {
    const result = prepareChatMessageWindow([]);
    expect(result.uniqueMessages).toEqual([]);
    expect(result.indexById.size).toBe(0);
    expect(result.duplicateCounts.size).toBe(0);
  });
});

describe("image predecode preparation", () => {
  it("preserves snake-case precedence and camel-case fallback", () => {
    expect(getChatMessageImageUrl({ image_url: "snake", imageUrl: "camel" })).toBe("snake");
    expect(getChatMessageImageUrl({ image_url: null, imageUrl: "camel" })).toBe("camel");
    expect(getChatMessageImageUrl({})).toBeNull();
  });

  it("prefetches each unique image row and never a discarded duplicate", () => {
    const messages = [
      { id: "one", image_url: "https://local.test/first.jpg" },
      { id: "one", image_url: "https://local.test/duplicate.jpg" },
      { id: "two", imageUrl: "https://local.test/second.jpg" },
      { id: "three", body: "text only" },
    ];

    const { result } = renderHook(() => usePreparedChatMessageWindow(messages));

    expect(result.current.uniqueMessages.map((message) => message.id)).toEqual(["one", "two", "three"]);
    expect(prefetchMock.mock.calls).toEqual([
      ["https://local.test/first.jpg"],
      ["https://local.test/second.jpg"],
    ]);
  });
});
