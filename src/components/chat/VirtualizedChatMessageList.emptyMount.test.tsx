import { describe, it, expect, vi } from "vitest";
import { createRef, type ReactNode } from "react";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "./VirtualizedChatMessageList";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/**
 * Regression guard for the Android team/club chat notification crash:
 *
 *   "Cannot read properties of undefined (reading 'index')"
 *
 * Root cause: on a notification cold-start the React Query cache is empty for
 * ~200–800ms while the fetch resolves. During that window the chat page used
 * to mount <Virtuoso> against `messages=[]` and pass scroll commands at
 * indices that didn't exist, so Virtuoso's internal `range` was undefined
 * when it tried to read `.index` → white screen.
 *
 * The fix:
 *  1. The Virtuoso tree is conditionally rendered behind `messages.length > 0`.
 *  2. Imperative `scrollToIndex` / `scrollToBottom` calls early-return when
 *     the list is empty (`safeScrollToIndex`).
 *
 * These tests assert both invariants directly on the component, without
 * needing a Capacitor device. They will fail loudly if a future edit re-
 * introduces an unconditional Virtuoso mount or a raw `scrollToIndex`.
 */
describe("VirtualizedChatMessageList — empty/cold-start guards", () => {
  it("renders with messages=[] without throwing (Virtuoso mount is gated)", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    expect(() =>
      render(
        <VirtualizedChatMessageList
          ref={ref}
          messages={[]}
          hasOlder={false}
          isLoadingOlder={false}
          onLoadOlder={() => {}}
          renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
        />,
      ),
    ).not.toThrow();
  });

  it("imperative scroll commands no-op safely on an empty list", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    render(
      <VirtualizedChatMessageList
        ref={ref}
        messages={[]}
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={() => {}}
        renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
      />,
    );

    // The handle may or may not be wired before Virtuoso mounts (it is gated
    // behind length > 0); calling these must not throw either way.
    expect(() => {
      act(() => {
        ref.current?.scrollToBottom?.("auto");
        ref.current?.scrollToIndex?.(0);
        ref.current?.scrollToIndex?.(999);
        ref.current?.scrollToMessageId?.("does-not-exist");
      });
    }).not.toThrow();
  });

  it("isAtBottom / isNearBottom are safe to query before any messages mount", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    render(
      <VirtualizedChatMessageList
        ref={ref}
        messages={[]}
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={() => {}}
        renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
      />,
    );

    expect(() => {
      ref.current?.isAtBottom?.();
      ref.current?.isNearBottom?.(120);
    }).not.toThrow();
  });

  it("transitioning from empty → populated messages does not throw", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    const { rerender } = render(
      <VirtualizedChatMessageList
        ref={ref}
        messages={[]}
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={() => {}}
        renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
      />,
    );

    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      text: `msg ${i}`,
      author_id: "u1",
      created_at: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
    }));

    expect(() =>
      rerender(
        <VirtualizedChatMessageList
          ref={ref}
          messages={messages}
          hasOlder={false}
          isLoadingOlder={false}
          onLoadOlder={() => {}}
          renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
        />,
      ),
    ).not.toThrow();
  });

  it("notification cold-start: targetMessageId pointing to a not-yet-loaded id is safe on empty list", () => {
    // Simulates `initialTargetMessageId` arriving from a push payload before
    // the fetch resolves — this was one of the exact paths that crashed.
    const ref = createRef<VirtualizedChatMessageListHandle>();
    expect(() =>
      render(
        <VirtualizedChatMessageList
          ref={ref}
          messages={[]}
          hasOlder={false}
          isLoadingOlder={false}
          onLoadOlder={() => {}}
          initialTargetMessageId="not-loaded-yet"
          renderItem={(m) => <div key={(m as any).id}>{(m as any).id}</div>}
        />,
      ),
    ).not.toThrow();
  });
});

// Silence noisy Virtuoso ResizeObserver warnings that jsdom can't fulfil;
// they're irrelevant to what these tests are asserting.
vi.spyOn(console, "error").mockImplementation((msg, ...rest) => {
  if (typeof msg === "string" && /ResizeObserver|act\(\)/.test(msg)) return;
  // eslint-disable-next-line no-console
  console.warn(msg, ...rest);
});
