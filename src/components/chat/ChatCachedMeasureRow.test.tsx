import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearChatRowHeightCache, getCachedRowHeight } from "./chatRowHeightCache";
import { ChatCachedMeasureRow } from "./ChatCachedMeasureRow";

const observers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];

vi.mock("@/lib/chatScrollActivity", () => ({
  getLastChatScrollAt: () => Number.NEGATIVE_INFINITY,
  runWhenChatScrollIdle: (callback: () => void) => {
    callback();
    return vi.fn();
  },
}));

vi.mock("./chatVirtuosoEnvironment", () => ({
  isAndroidNativeWebView: () => false,
}));

describe("ChatCachedMeasureRow", () => {
  let height = 120;

  beforeEach(() => {
    height = 120;
    observers.length = 0;
    clearChatRowHeightCache();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
    vi.stubGlobal("ResizeObserver", class {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes the mounted row height with its current signature", () => {
    render(<ChatCachedMeasureRow messageId="message-1" signature="signature-1">Message</ChatCachedMeasureRow>);
    expect(screen.getByText("Message")).toHaveAttribute("data-row-id", "message-1");
    expect(getCachedRowHeight("message-1", "signature-1")).toBe(120);
    expect(observers.length).toBeGreaterThanOrEqual(1);
  });

  it("rewrites the cache when layout-affecting content changes", () => {
    const { rerender } = render(
      <ChatCachedMeasureRow messageId="message-1" signature="signature-1">Before</ChatCachedMeasureRow>,
    );
    height = 168;
    rerender(<ChatCachedMeasureRow messageId="message-1" signature="signature-2">After</ChatCachedMeasureRow>);
    expect(getCachedRowHeight("message-1", "signature-2")).toBe(168);
    expect(getCachedRowHeight("message-1", "signature-1")).toBeUndefined();
  });

  it("captures live observer changes and disconnects observers on unmount", () => {
    const { unmount } = render(
      <ChatCachedMeasureRow messageId="message-1" signature="signature-1">Message</ChatCachedMeasureRow>,
    );
    height = 144;
    observers[0].callback([], observers[0] as unknown as ResizeObserver);
    expect(getCachedRowHeight("message-1", "signature-1")).toBe(144);
    const disconnects = observers.map((observer) => observer.disconnect);
    unmount();
    expect(disconnects.some((disconnect) => disconnect.mock.calls.length > 0)).toBe(true);
  });
});
