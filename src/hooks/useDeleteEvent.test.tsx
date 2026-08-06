import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { purgeDeletedEventFromCaches } from "@/lib/eventDeletionCache";

/**
 * Reliable event deletion contract.
 *
 * The old implementation navigated away, toasted "Event deleted", and ran the
 * database delete inside a 6s `setTimeout` — a timer that Android freezes when
 * the app is backgrounded, so the row often survived. These tests pin the
 * replacement: await the database, inspect the result, and only then toast and
 * navigate.
 */

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const deleteResults: Array<{ data?: Array<{ id: string }> | null; error?: { message: string } | null }> = [];
let deleteCallCount = 0;
let resolveGate: (() => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: () => {
          deleteCallCount += 1;
          const r = deleteResults.shift() ?? { data: [], error: null };
          return {
            select: async () => {
              if (resolveGate) {
                await new Promise<void>((res) => {
                  resolveGate = () => res();
                });
              }
              return { data: r.data ?? null, error: r.error ?? null };
            },
          };
        },
      }),
    }),
  },
}));

const { useDeleteEvent } = await import("@/hooks/useDeleteEvent");

function setup(onDeleted?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => useDeleteEvent({ onDeleted }), { wrapper });
  return { hook, queryClient };
}

beforeEach(() => {
  toastSpy.mockClear();
  deleteResults.length = 0;
  deleteCallCount = 0;
  resolveGate = null;
});

describe("useDeleteEvent", () => {
  it("navigates and toasts success only after the database confirms", async () => {
    deleteResults.push({ data: [{ id: "e1" }] });
    const onDeleted = vi.fn();
    const { hook } = setup(onDeleted);

    await act(async () => {
      await hook.result.current.deleteEvent({ id: "e1" }, "single");
    });

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Event deleted" }));
  });

  it("does not navigate or claim success when the delete fails", async () => {
    deleteResults.push({ error: { message: "permission denied" } });
    const onDeleted = vi.fn();
    const { hook } = setup(onDeleted);

    await act(async () => {
      await hook.result.current.deleteEvent({ id: "e1" }, "single");
    });

    expect(onDeleted).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("sends exactly one request for a double tap and exposes a pending state", async () => {
    deleteResults.push({ data: [{ id: "e1" }] });
    resolveGate = () => {};
    const { hook } = setup();

    let first: Promise<void>;
    await act(async () => {
      first = hook.result.current.deleteEvent({ id: "e1" }, "single");
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    // Second tap while in flight must be ignored entirely.
    await act(async () => {
      await hook.result.current.deleteEvent({ id: "e1" }, "single");
    });
    expect(deleteCallCount).toBe(1);

    await act(async () => {
      resolveGate?.();
      await first!;
    });
    expect(deleteCallCount).toBe(1);
    expect(hook.result.current.isPending).toBe(false);
  });

  it("keeps 'this event only' scoped to a single delete call", async () => {
    deleteResults.push({ data: [{ id: "child" }] });
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.deleteEvent({ id: "child", parent_event_id: "root" }, "single");
    });
    expect(deleteCallCount).toBe(1);
  });

  it("issues both series deletes for a series scope", async () => {
    deleteResults.push({ data: [{ id: "c1" }] }, { data: [{ id: "root" }] });
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.deleteEvent({ id: "root", is_recurring: true }, "series");
    });
    expect(deleteCallCount).toBe(2);
  });
});

describe("purgeDeletedEventFromCaches", () => {
  it("removes the deleted event from every cached event list", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["events", "team-1"], [{ id: "e1" }, { id: "e2" }]);
    queryClient.setQueryData(["upcoming-events"], [{ id: "e1" }]);
    queryClient.setQueryData(["photos"], [{ id: "e1" }]);

    await purgeDeletedEventFromCaches(queryClient, ["e1"]);

    expect(queryClient.getQueryData(["events", "team-1"])).toEqual([{ id: "e2" }]);
    expect(queryClient.getQueryData(["upcoming-events"])).toEqual([]);
    // Unrelated caches are untouched.
    expect(queryClient.getQueryData(["photos"])).toEqual([{ id: "e1" }]);
  });
});
