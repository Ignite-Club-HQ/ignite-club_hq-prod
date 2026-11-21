import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDirectMessageUpdates } from "./useDirectMessageUpdates";

const ws = vi.hoisted(() => ({ healthy: false, poke: undefined as undefined | (() => void), unsubscribe: vi.fn() }));
vi.mock("@/live/wsRealtime", () => ({
  isChatWsHealthy: () => ws.healthy,
  subscribeChatPokes: (callback: () => void) => { ws.poke = callback; return ws.unsubscribe; },
}));

describe("direct-message update transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ws.healthy = false;
    ws.poke = undefined;
    ws.unsubscribe.mockReset();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function setup(messagingOnIcp = true, enabled = true) {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const cleanup = vi.fn();
    const subscribeSupabase = vi.fn(() => cleanup);
    const options = { conversationId: "direct-1", userId: "account-1", enabled, messagingOnIcp, queryClient, subscribeSupabase };
    const hook = renderHook((props) => useDirectMessageUpdates(props), { initialProps: options });
    return { ...hook, options, invalidate, subscribeSupabase, cleanup };
  }

  it("never attempts the blocked Supabase live-update fallback on ICP", () => {
    const run = setup();
    act(() => vi.advanceTimersByTime(15_000));
    expect(run.subscribeSupabase).not.toHaveBeenCalled();
    expect(run.invalidate).toHaveBeenCalledWith({ queryKey: ["dm-messages", "direct-1"] });
    act(() => ws.poke?.());
    expect(run.invalidate).toHaveBeenCalledTimes(2);
  });

  it("keeps Supabase subscriptions and cleanup in email mode", () => {
    const run = setup(false);
    expect(run.subscribeSupabase).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(run.invalidate).not.toHaveBeenCalled();
    expect(ws.poke).toBeUndefined();
    run.unmount();
    expect(run.cleanup).toHaveBeenCalledTimes(1);
  });

  it("waits for authentication and retires email subscriptions on an ICP switch", () => {
    const run = setup(false, false);
    expect(run.subscribeSupabase).not.toHaveBeenCalled();
    run.rerender({ ...run.options, enabled: true });
    expect(run.subscribeSupabase).toHaveBeenCalledTimes(1);
    run.rerender({ ...run.options, enabled: true, messagingOnIcp: true });
    expect(run.cleanup).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(15_000));
    expect(run.subscribeSupabase).toHaveBeenCalledTimes(1);
    expect(run.invalidate).toHaveBeenCalledTimes(1);
  });

  it("pauses hidden polling, catches up on return, and stops on unmount", () => {
    const run = setup();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => vi.advanceTimersByTime(30_000));
    expect(run.invalidate).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(run.invalidate).toHaveBeenCalledTimes(1);
    run.unmount();
    expect(ws.unsubscribe).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(30_000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(run.invalidate).toHaveBeenCalledTimes(1);
  });

  it("uses socket pokes instead of polling while the ICP socket is healthy", () => {
    const run = setup();
    ws.healthy = true;
    act(() => vi.advanceTimersByTime(30_000));
    expect(run.invalidate).not.toHaveBeenCalled();
    act(() => ws.poke?.());
    expect(run.invalidate).toHaveBeenCalledTimes(1);
    ws.healthy = false;
    act(() => vi.advanceTimersByTime(15_000));
    expect(run.invalidate).toHaveBeenCalledTimes(2);
  });
});