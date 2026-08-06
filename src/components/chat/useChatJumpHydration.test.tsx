import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setChatJumpActive } from "@/lib/chatJumpActive";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { useChatJumpHydration } from "./useChatJumpHydration";

vi.mock("@/lib/chatInitialVisualSettle", () => ({
  waitForChatVisualContentSettle: vi.fn(),
}));

const settleMock = vi.mocked(waitForChatVisualContentSettle);

beforeEach(() => {
  vi.useFakeTimers();
  setChatJumpActive(false);
  settleMock.mockReset();
});

afterEach(() => {
  setChatJumpActive(false);
  vi.useRealTimers();
});

describe("useChatJumpHydration", () => {
  it("seeds the overlay when a notification jump started before mount", () => {
    setChatJumpActive(true);
    const scrollerRef = { current: null };
    const { result } = renderHook(() => useChatJumpHydration(scrollerRef));

    expect(result.current).toEqual({
      isJumpHydrating: true,
      renderJumpOverlay: true,
    });
  });

  it("waits for visible content to settle, then fades and unmounts", () => {
    const scroller = document.createElement("div");
    const cancel = vi.fn();
    let settled: (() => void) | undefined;
    settleMock.mockImplementation((_root, options, done) => {
      expect(options).toEqual({ quietMs: 650, maxMs: 8000 });
      settled = done;
      return cancel;
    });
    const scrollerRef = { current: scroller };
    const { result, unmount } = renderHook(() => useChatJumpHydration(scrollerRef));

    act(() => setChatJumpActive(true));
    expect(result.current.isJumpHydrating).toBe(true);

    act(() => setChatJumpActive(false));
    expect(settleMock).toHaveBeenCalledWith(scroller, { quietMs: 650, maxMs: 8000 }, expect.any(Function));
    expect(result.current.isJumpHydrating).toBe(true);

    act(() => {
      settled?.();
      vi.advanceTimersByTime(80);
    });
    expect(result.current).toEqual({
      isJumpHydrating: false,
      renderJumpOverlay: true,
    });

    act(() => vi.advanceTimersByTime(300));
    expect(result.current.renderJumpOverlay).toBe(false);

    unmount();
  });

  it("cancels an unsettled reveal when a new jump starts and on unmount", () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    settleMock
      .mockReturnValueOnce(cancelFirst)
      .mockReturnValueOnce(cancelSecond);
    const scrollerRef = { current: document.createElement("div") };
    const { unmount } = renderHook(() => useChatJumpHydration(scrollerRef));

    act(() => {
      setChatJumpActive(true);
      setChatJumpActive(false);
      setChatJumpActive(true);
    });
    expect(cancelFirst).toHaveBeenCalledOnce();

    act(() => setChatJumpActive(false));
    unmount();
    expect(cancelSecond).toHaveBeenCalledOnce();
  });

  it("uses the unchanged fallback timing when no scroller has mounted", () => {
    const scrollerRef = { current: null };
    const { result } = renderHook(() => useChatJumpHydration(scrollerRef));

    act(() => {
      setChatJumpActive(true);
      setChatJumpActive(false);
      vi.advanceTimersByTime(119);
    });
    expect(result.current.isJumpHydrating).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isJumpHydrating).toBe(false);
    expect(result.current.renderJumpOverlay).toBe(true);

    act(() => vi.advanceTimersByTime(300));
    expect(result.current.renderJumpOverlay).toBe(false);
  });
});
