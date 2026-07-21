import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  selectResults: [] as Array<{ data: any; error: any }>,
  insertResult: { data: null as any, error: null as any },
  queries: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import {
  useEventViewTracking,
  useEventViewsAdmin,
  useUserEventViews,
} from "./useEventViews";

function eventViewsQuery() {
  let result = mocks.selectResults.shift() ?? { data: null, error: null };
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.insert = vi.fn((value: any) => {
    chain.insertedValue = value;
    result = mocks.insertResult;
    return chain;
  });
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
  });
  mocks.queries.push(chain);
  return chain;
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

describe("event view tracking and reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.queries.length = 0;
    mocks.insertResult.data = null;
    mocks.insertResult.error = null;
    mocks.from.mockImplementation(eventViewsQuery);
  });

  it.each([
    [undefined, "user-1"],
    ["event-1", undefined],
  ])("does not query or record without both event and user identity", (eventId, userId) => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useEventViewTracking(eventId, userId), { wrapper });

    expect(result.current.hasViewed).toBeUndefined();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not insert another view when one already exists", async () => {
    mocks.selectResults.push({ data: { id: "view-1" }, error: null });
    const { wrapper } = harness();
    const { result } = renderHook(() => useEventViewTracking("event-1", "user-1"), { wrapper });

    await waitFor(() => expect(result.current.hasViewed).toBe(true));
    expect(mocks.queries).toHaveLength(1);
    expect(mocks.queries[0].insert).not.toHaveBeenCalled();
  });

  it("records a first view with the exact event and user scope", async () => {
    mocks.selectResults.push({ data: null, error: null });
    const { wrapper, invalidate } = harness();
    renderHook(() => useEventViewTracking("event-1", "user-1"), { wrapper });

    await waitFor(() => expect(
      mocks.queries.some(query => query.insert.mock.calls.length > 0),
    ).toBe(true));
    const insertion = mocks.queries.find(query => query.insert.mock.calls.length > 0);
    expect(insertion.insert).toHaveBeenCalledWith({
      event_id: "event-1",
      user_id: "user-1",
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event-view-check", "event-1", "user-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event-views", "event-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-event-views"] });
  });

  it("treats a duplicate insert as a successful idempotent view", async () => {
    mocks.selectResults.push({ data: null, error: null });
    mocks.insertResult.error = { message: "duplicate key value violates unique constraint" };
    const { wrapper, invalidate } = harness();
    renderHook(() => useEventViewTracking("event-1", "user-1"), { wrapper });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
  });

  it("must not attempt a write when checking existing view state fails", async () => {
    mocks.selectResults.push({ data: null, error: { message: "view lookup denied" } });
    const { wrapper } = harness();
    const { result } = renderHook(() => useEventViewTracking("event-1", "user-1"), { wrapper });

    await waitFor(() => expect(result.current.hasViewed).toBe(false));
    expect(mocks.queries.some(query => query.insert.mock.calls.length > 0)).toBe(false);
  });

  it("does not invalidate successful caches after a non-duplicate insert failure", async () => {
    mocks.selectResults.push({ data: null, error: null });
    mocks.insertResult.error = { message: "insert denied" };
    const { wrapper, invalidate } = harness();
    renderHook(() => useEventViewTracking("event-1", "user-1"), { wrapper });

    await waitFor(() => expect(mocks.queries).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("loads an admin viewer list only when enabled and event-scoped", async () => {
    mocks.selectResults.push({ data: [{ id: "view-1", user_id: "user-1", viewed_at: "2026-07-20T12:00:00Z" }], error: null });
    const { wrapper } = harness();
    const { result } = renderHook(() => useEventViewsAdmin("event-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(mocks.queries[0].eq).toHaveBeenCalledWith("event_id", "event-1");
  });

  it.each([[undefined, true], ["event-1", false]] as const)(
    "does not load the admin viewer list for event %s with enabled=%s",
    (eventId, enabled) => {
      const { wrapper } = harness();
      const { result } = renderHook(() => useEventViewsAdmin(eventId, enabled), { wrapper });
      expect(result.current.fetchStatus).toBe("idle");
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it("surfaces an admin viewer lookup failure", async () => {
    mocks.selectResults.push({ data: null, error: { message: "admin lookup denied" } });
    const { wrapper } = harness();
    const { result } = renderHook(() => useEventViewsAdmin("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ message: "admin lookup denied" });
  });

  it("returns a deduplicated set of viewed event IDs for the current user", async () => {
    mocks.selectResults.push({ data: [
      { event_id: "event-1" },
      { event_id: "event-1" },
      { event_id: "event-2" },
    ], error: null });
    const { wrapper } = harness();
    const { result } = renderHook(() => useUserEventViews("user-1", ["event-2", "event-1"]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set(["event-1", "event-2"]));
    expect(mocks.queries[0].eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mocks.queries[0].in).toHaveBeenCalledWith("event_id", ["event-1", "event-2"]);
  });

  it("must not mutate the caller's event ID array while building its cache key", () => {
    const eventIds = ["event-2", "event-1"];
    const { wrapper } = harness();
    renderHook(() => useUserEventViews("user-1", eventIds), { wrapper });

    expect(eventIds).toEqual(["event-2", "event-1"]);
  });

  it.each([
    [undefined, ["event-1"]],
    ["user-1", []],
  ] as const)("does not load user views for user %s and event IDs %j", (userId, eventIds) => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useUserEventViews(userId, [...eventIds]), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
