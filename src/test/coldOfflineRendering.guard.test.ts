import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: cold-offline must never leave Schedule on "Loading events..." or
 * Media on a blank/skeleton content area. Both pages read their user-scoped
 * cache and render it, and neither gates rendering on membership /
 * entitlement queries that can't resolve without a network.
 */
const events = readFileSync(join(__dirname, "../pages/EventsPage.tsx"), "utf8");
const media = readFileSync(join(__dirname, "../pages/MediaPage.tsx"), "utf8");

describe("cold-offline rendering guards", () => {
  it("EventsPage tracks online status", () => {
    expect(events).toMatch(/useOnlineStatus/);
  });

  it("EventsPage never shows the full-page spinner while offline", () => {
    expect(events).toMatch(/isStuckOnSpinner\s*=\s*\n?\s*isOnline &&/);
  });

  it("EventsPage falls back to the user-scoped schedule cache when offline", () => {
    expect(events).toMatch(/offlineCachedEvents/);
    expect(events).toMatch(/getCachedEventsList\(eventsScopeKey, user\?\.id\)/);
    expect(events).toMatch(/eventsData \?\? offlineCachedEvents/);
  });

  it("EventsPage shows a friendly offline empty state", () => {
    expect(events).toMatch(/You're offline and no saved schedule is available yet/);
  });

  it("MediaPage does not gate rendering on the pro-access check while offline", () => {
    expect(media).toMatch(/const isCheckingProAccess = isOnline &&/);
  });

  it("MediaPage never shows skeletons while offline", () => {
    expect(media).toMatch(/const showSkeletons = isOnline &&/);
  });

  it("MediaPage keeps cached photos visible when the pro check fails", () => {
    expect(media).toMatch(/hasProAccessQueryFailed && photos\.length === 0/);
  });

  it("MediaPage shows a friendly offline empty state", () => {
    expect(media).toMatch(/You're offline and no saved photos are available yet/);
  });
});
