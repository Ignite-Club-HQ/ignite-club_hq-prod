import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => { localStorage.clear(); vi.resetModules(); });
it("keeps the saved home team cards when the general query cache fills the budget", async () => {
  const { writeBoundedReadCache } = await import("./deviceCacheBudget");
  const carousel = "ignite_my_teams_carousel_v2_principal:abc_all";
  expect(writeBoundedReadCache(carousel, JSON.stringify({ timestamp: Date.now(), data: "x".repeat(100_000) }))).toBe(true);
  // ~1.9 MB of general cache, written later.
  writeBoundedReadCache("ignite_query_cache_v1", JSON.stringify({ timestamp: Date.now(), data: "y".repeat(950_000) }));
  expect(localStorage.getItem(carousel)).not.toBeNull();
});
