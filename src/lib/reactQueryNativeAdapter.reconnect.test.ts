/**
 * Regression: after a network drop → restore cycle, the club theme must
 * remain applied. The recovery path relies on `reactQueryNativeAdapter`
 * invalidating the theme-critical queries on reconnect so that any
 * background refetch fires the fallback logic in `useClubTheme` (which
 * keeps the cached theme when the club still appears in `userClubs`).
 *
 * This test drives the adapter directly by:
 *   1. Faking `Capacitor.isNativePlatform() === true`.
 *   2. Faking `@capacitor/network` so we can flip connectivity on demand.
 *   3. Faking `@capacitor/app` to no-op the foreground listener.
 *   4. Seeding a `QueryClient` with theme queries, then flipping offline →
 *      online and asserting that the theme-critical queries are marked
 *      stale (invalidated). Also confirms an errored query is invalidated
 *      so the theme provider can re-fetch and re-apply.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, onlineManager } from "@tanstack/react-query";

// ---- Capacitor mocks ---------------------------------------------------
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

type NetHandler = (status: { connected: boolean }) => void;
const networkListeners: NetHandler[] = [];
let currentConnected = true;

const flipNetwork = (connected: boolean) => {
  currentConnected = connected;
  networkListeners.forEach((h) => h({ connected }));
};

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: async () => ({ connected: currentConnected }),
    addListener: (_event: string, handler: NetHandler) => {
      networkListeners.push(handler);
      return { remove: () => {} };
    },
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_event: string, _handler: unknown) => {
      return { remove: () => {} };
    },
  },
}));

// Import AFTER mocks so the module picks them up.
import { setupReactQueryNativeAdapter } from "./reactQueryNativeAdapter";

describe("reactQueryNativeAdapter — reconnect preserves club theme", () => {
  let qc: QueryClient;

  beforeEach(() => {
    networkListeners.length = 0;
    currentConnected = true;
    onlineManager.setOnline(true);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    qc.clear();
  });

  it("invalidates theme-critical queries and errored queries on offline→online", async () => {
    // Seed the caches the adapter targets by name.
    qc.setQueryData(["club-themes", "user-1"], [{ clubId: "club-x" }]);
    qc.setQueryData(["user-clubs-for-switcher", "user-1"], [{ id: "club-x" }]);
    qc.setQueryData(["all-user-clubs-for-theme-v2", "user-1"], [{ clubId: "club-x" }]);

    // Seed an errored query to represent the messages/schedule fetch that
    // failed while offline. The adapter must kick this so the app recovers
    // without a relaunch.
    await qc.fetchQuery({
      queryKey: ["some-page-data"],
      queryFn: async () => {
        throw new Error("offline");
      },
    }).catch(() => {});

    setupReactQueryNativeAdapter(qc);
    // Let the async dynamic imports (@capacitor/network, @capacitor/app) resolve.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    // Drop the network — mirrors radio off / airplane mode.
    flipNetwork(false);
    expect(onlineManager.isOnline()).toBe(false);

    // Restore the network.
    flipNetwork(true);
    // Give the adapter's recovery microtask a chance to fire.
    await new Promise((r) => setTimeout(r, 5));

    expect(onlineManager.isOnline()).toBe(true);

    // The three theme-critical query keys must have been invalidated so
    // any subsequent background refetch feeds the theme provider's
    // fallback logic (which preserves the cached theme when the club is
    // still present in `userClubs`).
    const invalidatedKeys = invalidateSpy.mock.calls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(invalidatedKeys).toContain("club-themes");
    expect(invalidatedKeys).toContain("user-clubs-for-switcher");
    expect(invalidatedKeys).toContain("all-user-clubs-for-theme-v2");

    // AND the errored non-theme query is kicked so pages recover.
    expect(invalidatedKeys).toContain("some-page-data");

    // The cached theme data itself must survive (never removed by the
    // adapter — that's the whole guarantee behind theme persistence).
    expect(qc.getQueryData(["club-themes", "user-1"])).toEqual([
      { clubId: "club-x" },
    ]);
    expect(qc.getQueryData(["user-clubs-for-switcher", "user-1"])).toEqual([
      { id: "club-x" },
    ]);
  });
});
