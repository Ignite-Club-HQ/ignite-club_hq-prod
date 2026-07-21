import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, from, isNativePlatform, subscriptionResult } = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  isNativePlatform: vi.fn(),
  subscriptionResult: { data: [] as any[], error: null as any },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession }, from },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform },
}));

import { useNotificationNudge } from "./useNotificationNudge";

function subscriptionQuery() {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve(subscriptionResult).then(resolve),
  });
  return query;
}

describe("useNotificationNudge delivery eligibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    isNativePlatform.mockReturnValue(false);
    subscriptionResult.data = [];
    subscriptionResult.error = null;
    from.mockImplementation(() => subscriptionQuery());
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-19T12:00:00Z").getTime());
  });

  it("does not query notification state without a user", async () => {
    const { result } = renderHook(() => useNotificationNudge(undefined, "event"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.shouldShowNudge).toBe(false);
    expect(result.current.hasPushEnabled).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("does not query subscriptions without an active session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useNotificationNudge("user-1", "event"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.shouldShowNudge).toBe(false);
  });

  it("does not nudge when a web push subscription exists", async () => {
    subscriptionResult.data = [{ id: "subscription-1" }];
    const { result } = renderHook(() => useNotificationNudge("user-1", "event"));

    await waitFor(() => expect(result.current.hasPushEnabled).toBe(true));
    expect(result.current.shouldShowNudge).toBe(false);
    expect(localStorage.getItem("notification-nudge-status-event-user-1")).toBe("enabled");
  });

  it("shows a nudge only after a successful lookup confirms no subscription", async () => {
    const { result } = renderHook(() => useNotificationNudge("user-1", "event"));

    expect(result.current.shouldShowNudge).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPushEnabled).toBe(false);
    expect(result.current.shouldShowNudge).toBe(true);
    expect(localStorage.getItem("notification-nudge-status-event-user-1")).toBe("disabled");
  });

  it("must not show a false enable-notifications nudge when subscription lookup fails", async () => {
    subscriptionResult.error = { message: "subscription lookup unavailable" };
    const { result } = renderHook(() => useNotificationNudge("user-1", "event"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPushEnabled).toBe(true);
    expect(result.current.shouldShowNudge).toBe(false);
    expect(localStorage.getItem("notification-nudge-status-event-user-1")).toBeNull();
  });

  it("dismisses only the current user and context for seven days", async () => {
    const { result } = renderHook(() => useNotificationNudge("user-1", "event"));
    await waitFor(() => expect(result.current.shouldShowNudge).toBe(true));

    act(() => result.current.dismiss());

    expect(result.current.shouldShowNudge).toBe(false);
    expect(localStorage.getItem("notification-nudge-dismissed-event-user-1")).toBe(
      String(Date.now()),
    );
    expect(localStorage.getItem("notification-nudge-dismissed-chat-user-1")).toBeNull();
    expect(localStorage.getItem("notification-nudge-dismissed-event-user-2")).toBeNull();
  });

  it("honours an active dismissal without querying, but rechecks after cooldown expiry", async () => {
    const now = Date.now();
    const activeDismissal = now - 6 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      "notification-nudge-dismissed-event-user-1",
      String(activeDismissal),
    );
    const active = renderHook(() => useNotificationNudge("user-1", "event"));
    await waitFor(() => expect(active.result.current.isLoading).toBe(false));
    expect(active.result.current.shouldShowNudge).toBe(false);
    expect(from).not.toHaveBeenCalled();
    active.unmount();

    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    isNativePlatform.mockReturnValue(false);
    from.mockImplementation(() => subscriptionQuery());
    localStorage.setItem(
      "notification-nudge-dismissed-event-user-1",
      String(now - 8 * 24 * 60 * 60 * 1000),
    );
    const expired = renderHook(() => useNotificationNudge("user-1", "event"));

    await waitFor(() => expect(expired.result.current.shouldShowNudge).toBe(true));
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(localStorage.getItem("notification-nudge-dismissed-event-user-1")).toBeNull();
  });
});
