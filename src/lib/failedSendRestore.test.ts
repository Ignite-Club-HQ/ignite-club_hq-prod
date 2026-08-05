import { describe, it, expect } from "vitest";
import {
  authoritativeMessageExists,
  AUTHORITATIVE_MATCH_SKEW_MS,
  splitPollMarkup,
  createSendTempId,
} from "./failedSendRestore";

const NOW = 1_760_000_000_000;
const AUTHOR = "author-1";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "real-1",
    author_id: AUTHOR,
    text: "hello",
    image_url: null,
    reply_to_id: null,
    created_at: new Date(NOW + 500).toISOString(),
    ...over,
  } as never;
}

const base = { authorId: AUTHOR, text: "hello", imageUrl: null, replyToId: null, sentAtMs: NOW };

describe("authoritativeMessageExists", () => {
  it("matches a recent exact payload", () => {
    expect(authoritativeMessageExists([row()], base)).toBe(true);
  });

  it("does not match an old same-author, same-text message", () => {
    const old = row({ created_at: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() });
    expect(authoritativeMessageExists([old], base)).toBe(false);
  });

  it("does not match a different author", () => {
    expect(authoritativeMessageExists([row({ author_id: "other" })], base)).toBe(false);
  });

  it("does not match different text", () => {
    expect(authoritativeMessageExists([row({ text: "hello there" })], base)).toBe(false);
  });

  it("does not match a different attachment", () => {
    expect(authoritativeMessageExists([row({ image_url: "https://x/y.jpg" })], base)).toBe(false);
    expect(
      authoritativeMessageExists([row()], { ...base, imageUrl: "https://x/y.jpg" }),
    ).toBe(false);
  });

  it("does not match a different reply target", () => {
    expect(authoritativeMessageExists([row({ reply_to_id: "msg-9" })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, replyToId: "msg-9" })).toBe(false);
  });

  it("ignores temp-* and queued-* rows", () => {
    expect(authoritativeMessageExists([row({ id: "temp-abc" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ id: "queued-abc" })], base)).toBe(false);
  });

  it("tolerates reasonable clock skew", () => {
    const skewed = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS - 1000)).toISOString() });
    expect(authoritativeMessageExists([skewed], base)).toBe(true);
    const tooEarly = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS + 5000)).toISOString() });
    expect(authoritativeMessageExists([tooEarly], base)).toBe(false);
  });

  it("fails safe on malformed or missing timestamps", () => {
    expect(authoritativeMessageExists([row({ created_at: "not-a-date" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ created_at: null })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: undefined })).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: NaN })).toBe(false);
  });

  it("handles empty inputs", () => {
    expect(authoritativeMessageExists([], base)).toBe(false);
    expect(authoritativeMessageExists(null, base)).toBe(false);
  });
});

describe("composer helpers", () => {
  it("splits poll markup", () => {
    expect(splitPollMarkup("caption [poll:abc]")).toEqual({ baseText: "caption", pollId: "abc" });
    expect(splitPollMarkup("plain")).toEqual({ baseText: "plain", pollId: null });
  });

  it("creates unique temp ids", () => {
    expect(createSendTempId()).not.toBe(createSendTempId());
  });
});
