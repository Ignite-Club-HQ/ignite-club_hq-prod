import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { from, results, queries } = vi.hoisted(() => ({
  from: vi.fn(),
  results: new Map<string, Array<{ data: any; error: any }>>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { findNearbyGameEvent } from "./useNearbyGameEvent";

function tableQuery(table: string) {
  const result = results.get(table)?.shift() ?? { data: null, error: null };
  const chain: any = {};
  for (const method of ["select", "eq", "gte", "lte", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
  });
  queries.push({ table, chain });
  return chain;
}

const at = (offsetMinutes: number) =>
  new Date(new Date("2026-07-20T12:00:00Z").getTime() + offsetMinutes * 60_000).toISOString();

describe("findNearbyGameEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    vi.clearAllMocks();
    results.clear();
    queries.length = 0;
    from.mockImplementation(tableQuery);
  });

  afterEach(() => vi.useRealTimers());

  it("prefers a current linked active game without querying the general event list", async () => {
    results.set("active_games", [{ data: { pitch_state: { linkedEventId: "event-live" } }, error: null }]);
    results.set("events", [{ data: { event_date: at(-30), is_cancelled: false }, error: null }]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBe("event-live");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["active_games", "events"]);
  });

  it.each([
    ["cancelled", { event_date: at(0), is_cancelled: true }],
    ["too old", { event_date: at(-181), is_cancelled: false }],
    ["too far ahead", { event_date: at(121), is_cancelled: false }],
  ])("ignores a %s linked active-game event and falls back", async (_label, linkedEvent) => {
    results.set("active_games", [{ data: { pitch_state: { linkedEventId: "stale-event" } }, error: null }]);
    results.set("events", [
      { data: linkedEvent, error: null },
      { data: [{ id: "fallback-event", event_date: at(20) }], error: null },
    ]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBe("fallback-event");
  });

  it("falls back when there is no active game or linked event identity", async () => {
    results.set("active_games", [{ data: { pitch_state: {} }, error: null }]);
    results.set("events", [{ data: [{ id: "nearby-event", event_date: at(10) }], error: null }]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBe("nearby-event");
  });

  it("scopes fallback lookup to non-cancelled games for the requested team and time window", async () => {
    results.set("active_games", [{ data: null, error: null }]);
    results.set("events", [{ data: [], error: null }]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBeNull();
    const fallback = queries.find(q => q.table === "events")!.chain;
    expect(fallback.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(fallback.eq).toHaveBeenCalledWith("type", "game");
    expect(fallback.eq).toHaveBeenCalledWith("is_cancelled", false);
    expect(fallback.gte).toHaveBeenCalledWith("event_date", "2026-07-20T09:00:00.000Z");
    expect(fallback.lte).toHaveBeenCalledWith("event_date", "2026-07-20T14:00:00.000Z");
    expect(fallback.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when both active-game and event discovery fail", async () => {
    results.set("active_games", [{ data: null, error: { message: "active lookup failed" } }]);
    results.set("events", [{ data: null, error: { message: "event lookup failed" } }]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBeNull();
  });

  it("must select the temporally closest eligible game, not simply the oldest", async () => {
    results.set("active_games", [{ data: null, error: null }]);
    results.set("events", [{ data: [
      { id: "old-game", event_date: at(-170) },
      { id: "near-game", event_date: at(10) },
    ], error: null }]);

    await expect(findNearbyGameEvent("team-1")).resolves.toBe("near-game");
  });
});
