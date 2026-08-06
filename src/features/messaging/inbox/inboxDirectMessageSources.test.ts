import { describe, expect, it } from "vitest";
import {
  hydrateCachedDirectMessages,
  buildPreviousDirectMessagePeerMap,
  resolveDirectMessagePeerProfile,
  resolveEffectiveDirectMessages,
} from "./inboxDirectMessageSources";

describe("buildPreviousDirectMessagePeerMap", () => {
  const livePeer = { id: "peer-1", display_name: "Current Name", avatar_url: "current.jpg" };
  const cachedPeer = { id: "peer-1", display_name: "Old Name", avatar_url: "old.jpg" };

  it("uses the current React Query identity ahead of an older persistent identity", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: livePeer }],
      cached: [{ other_user: cachedPeer }],
    });
    expect(result.get("peer-1")).toBe(livePeer);
  });

  it("fills identities missing from the live result using persistent cache", () => {
    const cachedOnly = { id: "peer-2", display_name: "Cached Peer", avatar_url: null };
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: livePeer }],
      cached: [{ other_user: cachedOnly }],
    });
    expect([...result.entries()]).toEqual([
      ["peer-1", livePeer],
      ["peer-2", cachedOnly],
    ]);
  });

  it("ignores live identities without an id or usable display name", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [
        { other_user: { id: "", display_name: "No ID", avatar_url: null } },
        { other_user: { id: "peer-1", display_name: null, avatar_url: "avatar.jpg" } },
        { other_user: null },
      ],
    });
    expect(result.size).toBe(0);
  });

  it("allows a valid cached identity to replace an unusable live identity", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: { id: "peer-1", display_name: null, avatar_url: "new.jpg" } }],
      cached: [{ other_user: cachedPeer }],
    });
    expect(result.get("peer-1")).toBe(cachedPeer);
  });

  it("returns an empty map when neither source contains conversations", () => {
    expect(buildPreviousDirectMessagePeerMap({ live: null, cached: undefined }).size).toBe(0);
  });
});

describe("resolveDirectMessagePeerProfile", () => {
  const fetched = { id: "peer", display_name: "Fresh Name", avatar_url: "fresh.jpg" };
  const previous = { id: "peer", display_name: "Previous Name", avatar_url: "previous.jpg", retained: true };
  const globalCached = { id: "peer", display_name: "Global Name", avatar_url: "global.jpg" };

  it("prefers a freshly fetched named profile and its avatar", () => {
    expect(resolveDirectMessagePeerProfile({ otherUserId: "peer", fetched, previous, globalCached })).toEqual({
      id: "peer", display_name: "Fresh Name", avatar_url: "fresh.jpg",
    });
  });

  it("fills a missing fresh avatar from the previous inbox identity before global cache", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { ...fetched, avatar_url: null },
      previous,
      globalCached,
    })).toEqual({ id: "peer", display_name: "Fresh Name", avatar_url: "previous.jpg" });
  });

  it("fills a missing fresh avatar from global cache when no previous avatar exists", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { ...fetched, avatar_url: null },
      previous: { ...previous, avatar_url: null },
      globalCached,
    })).toEqual({ id: "peer", display_name: "Fresh Name", avatar_url: "global.jpg" });
  });

  it("retains the previous named inbox identity when the fresh result has no name", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "peer", display_name: null, avatar_url: "fresh.jpg" },
      previous,
      globalCached,
    })).toBe(previous);
  });

  it("uses global cache when neither fresh nor previous data has a usable name", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "peer", display_name: null, avatar_url: "fresh.jpg" },
      previous: null,
      globalCached,
    })).toEqual({ id: "peer", display_name: "Global Name", avatar_url: "global.jpg" });
  });

  it("keeps a fresh identity-only result when no named fallback exists", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "unexpected-id", display_name: null, avatar_url: "fresh.jpg" },
    })).toEqual({ id: "peer", display_name: null, avatar_url: "fresh.jpg" });
  });

  it("returns null only when every profile source is absent", () => {
    expect(resolveDirectMessagePeerProfile({ otherUserId: "peer" })).toBeNull();
  });
});

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
