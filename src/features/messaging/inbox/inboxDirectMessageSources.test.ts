import { describe, expect, it } from "vitest";
import {
  hydrateCachedDirectMessages,
  resolveEffectiveDirectMessages,
} from "./inboxDirectMessageSources";

describe("hydrateCachedDirectMessages", () => {
  it("returns an empty list without cached conversations", () => {
    expect(hydrateCachedDirectMessages({ conversations: null })).toEqual([]);
  });

  it("preserves row fields and normalizes missing creation metadata", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", updated_at: "2026-08-01", label: "kept" }],
    });
    expect(result).toMatchObject({
      id: "dm-1", label: "kept", created_at: "2026-08-01", created_by: null,
      last_message: null,
    });
  });

  it("does not replace existing creation metadata", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", created_at: "created", updated_at: "updated", created_by: "owner" }],
    });
    expect(result.created_at).toBe("created");
    expect(result.created_by).toBe("owner");
  });

  it("hydrates a sent-by-me preview with the current user author id", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", other_user: { id: "peer" } }],
      latestMessages: { "dm-1": { text: "Hello", created_at: "now", author: "You" } },
      currentUserId: "me",
    });
    expect(result.last_message).toEqual({
      text: "Hello", image_url: null, created_at: "now", author_id: "me",
    });
  });

  it("hydrates a received preview with the peer author id", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", other_user: { id: "peer" } }],
      latestMessages: { "dm-1": { text: null, image_url: "photo.jpg", created_at: "now", author: "Peer" } },
      currentUserId: "me",
    });
    expect(result.last_message).toEqual({
      text: null, image_url: "photo.jpg", created_at: "now", author_id: "peer",
    });
  });
});

describe("resolveEffectiveDirectMessages", () => {
  const sticky = [{ id: "live" }];
  const cached = [{ id: "cached" }];

  it("preserves a non-empty sticky list online and offline", () => {
    expect(resolveEffectiveDirectMessages({ sticky, offlineCached: cached, isOnline: true })).toBe(sticky);
    expect(resolveEffectiveDirectMessages({ sticky, offlineCached: cached, isOnline: false })).toBe(sticky);
  });

  it("uses cached rows only while offline and sticky is empty", () => {
    expect(resolveEffectiveDirectMessages({ sticky: [], offlineCached: cached, isOnline: false })).toBe(cached);
    expect(resolveEffectiveDirectMessages({ sticky: [], offlineCached: cached, isOnline: true })).toEqual([]);
  });

  it("returns an empty list when neither source has rows", () => {
    expect(resolveEffectiveDirectMessages({ sticky: null, offlineCached: null, isOnline: false })).toEqual([]);
  });
});
