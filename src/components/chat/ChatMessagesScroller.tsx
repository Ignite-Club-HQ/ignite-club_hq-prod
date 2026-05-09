import { useCallback, useEffect, useRef, type CSSProperties, type MutableRefObject, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";

/**
 * Shared scroller used by Team / Group / Club / Broadcast chat pages.
 *
 * Virtualisation is unconditional: the virtualised list (`react-virtuoso`)
 * is always used for normal viewing. The legacy mapped DOM is retained ONLY
 * when search is active, because the existing search-result jump uses
 * `document.getElementById('message-${id}')` which requires every match to
 * be mounted. Once search is rewired to call the Virtuoso handle's
 * `scrollToIndex`, the legacy branch can be removed entirely.
 */
interface ChatMessagesScrollerProps<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderRow: (msg: TMessage, index: number, arr: TMessage[]) => ReactNode;

  // Layout / behaviour
  searchQuery: string;
  isPinned: boolean;
  isNativeIOS: boolean;
  isKeyboardOpen: boolean;
  searchOpen: boolean;
  composerHeight: number;

  // Refs the legacy hooks attach to. Optional now: pages migrated to
  // Virtuoso-owned scroll (see `keepVirtualizedInSearch`) no longer pass them.
  scrollAreaRef?: RefObject<HTMLDivElement>;
  loadTriggerRef?: RefObject<HTMLDivElement>;
  messagesEndRef?: RefObject<HTMLDivElement>;
  endElementId?: string;

  /** Forwarded to the load-trigger sentinel for parity with existing code. */
  loadTriggerStyle?: CSSProperties;

  /**
   * Pages that have rewired their search jump-to-message to Virtuoso's
   * `scrollToIndex` (via the exposed handle) pass `true` so the legacy
   * fallback DOM is skipped during search and Virtuoso owns scroll
   * end-to-end. Default false preserves the legacy fallback for un-migrated
   * pages.
   */
  keepVirtualizedInSearch?: boolean;

  /**
   * Optional handle ref. When provided, the parent owns the
   * VirtualizedChatMessageList handle and can imperatively call
   * `scrollToBottom`, `scrollToIndex`, `isAtBottom`, `isNearBottom`. The
   * internal keyboard/composer re-pin effect uses the same ref.
   */
  virtualHandleRef?: RefObject<VirtualizedChatMessageListHandle>;
}

export function ChatMessagesScroller<TMessage extends { id: string }>(
  props: ChatMessagesScrollerProps<TMessage>,
) {
  const useVirtualized = !!props.keepVirtualizedInSearch || !props.searchQuery;
  const {
    messages,
    hasOlderMessages,
    isLoadingOlder,
    onLoadOlder,
    renderRow,
    searchQuery,
    isPinned,
    isNativeIOS,
    isKeyboardOpen,
    searchOpen,
    composerHeight,
    scrollAreaRef,
    loadTriggerRef,
    messagesEndRef,
    endElementId,
    loadTriggerStyle,
    virtualHandleRef: externalVirtualHandleRef,
  } = props;

  // CRITICAL: the composer is `position: fixed` (NOT a flex sibling) and the
  // chat container's `height` only subtracts the bottom-nav offset / native
  // keyboard height — it does NOT subtract the composer's own height. That
  // means the bottom `composerHeight` pixels of the scroller always sit
  // behind the fixed composer. We must reserve that space inside the
  // scroller, otherwise the latest messages (and replies, where the
  // composer grows to ~100-140px with the reply pill) render off-screen
  // behind the input. Add a small breathing gap so the newest bubble
  // doesn't kiss the composer border.
  const COMPOSER_GAP = 16;
  const safeComposer = Math.max(composerHeight, 56); // floor for first paint before measure
  const bottomPad = searchOpen
    ? 16
    : isKeyboardOpen
    ? safeComposer + COMPOSER_GAP
    : `calc(${safeComposer + COMPOSER_GAP}px + env(safe-area-inset-bottom, 0px))`;

  const internalVirtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const virtualHandleRef = externalVirtualHandleRef ?? internalVirtualHandleRef;
  // CRITICAL: Do NOT hand Virtuoso's internal scroller to the legacy
  // `scrollAreaRef`. Legacy chat hooks (auto-scroll, bottom-pin, older-message
  // anchor) imperatively mutate `scrollTop` on whatever element this ref
  // points at — and Virtuoso also drives that element. Two owners on the
  // same scrollTop produces the "rows stacking / jump on fast scroll"
  // corruption the user reported. Keep the ref null in virtualised mode so
  // legacy hooks no-op; Virtuoso owns scrolling end-to-end via its handle.
  const setVirtualScrollerRef = useCallback((_element: HTMLElement | Window | null) => {
    // intentional no-op
  }, []);

  useEffect(() => {
    if (useVirtualized && scrollAreaRef) {
      // Make sure no stale legacy ref points at a now-unmounted Virtuoso
      // scroller from a previous render of this component.
      (scrollAreaRef as MutableRefObject<HTMLDivElement | null>).current = null;
    }
  }, [scrollAreaRef, useVirtualized]);

  // The legacy initial-pin hook is intentionally disabled in virtualized mode,
  // so it never flips `isPinned` / enables top pagination there. Do that once
  // the list has real data; otherwise the wrapper can stay opacity:0 (blank)
  // and `startReached` can be called before the first bottom pin completes.
  const virtualReady = !useVirtualized || messages.length > 0;
  const lastMessageId = messages[messages.length - 1]?.id;

  // When the keyboard opens/closes or the composer grows, the viewport
  // resizes underneath the virtualised list. If the user was at the bottom
  // we must re-pin to the latest message — otherwise the most recent
  // messages get hidden behind the keyboard and they "can't see what they
  // just sent". Fires immediately and again after the keyboard animation.
  useEffect(() => {
    if (!useVirtualized || searchQuery || !virtualReady) return;
    const handle = virtualHandleRef.current;
    if (!handle) return;
    const isReplyOrEditResize = composerHeight > 64;
    const wasAtBottom = handle.isAtBottom();
    if (!isReplyOrEditResize && !wasAtBottom) return;

    // Re-pin guard: when the user starts a reply/edit (composer grows) we
    // ALWAYS want the latest message visible above the composer + keyboard,
    // even if the timing of `isAtBottom` flips false mid-resize. Otherwise
    // honour the user's scroll position.
    const shouldRepin = () =>
      handle.isAtBottom() || (isReplyOrEditResize && wasAtBottom);

    const pin = () => handle.scrollToBottom("auto");
    pin();

    // Schedule multiple re-pins to cover:
    //  - immediate composer height change (DOM commit)
    //  - keyboard animation start (~80ms)
    //  - keyboard mid-animation (~280ms)
    //  - keyboard fully settled on Android (~550ms — longest observed)
    //  - very-late visualViewport reflow on some Android keyboards (~900ms)
    // Each later jump still re-checks user intent so we never yank a finger
    // that has started scrolling history mid-animation.
    const delays = [80, 280, 550, 900];
    const timeouts = delays.map((ms) =>
      window.setTimeout(() => {
        if (shouldRepin()) pin();
      }, ms),
    );

    // Belt-and-braces: also re-pin on every visualViewport resize while this
    // effect is alive. Android Chrome resizes visualViewport multiple times
    // as the keyboard settles, and on some devices the LAST resize lands
    // after our 550ms timeout but before 900ms — without listening for it
    // the latest message can end up partially clipped behind the composer.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const onViewportResize = () => {
      if (shouldRepin()) pin();
    };
    vv?.addEventListener("resize", onViewportResize);

    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, [useVirtualized, searchQuery, virtualReady, isKeyboardOpen, composerHeight, bottomPad, lastMessageId]);

  // Stable renderer identity — recreating it on every parent re-render
  // invalidates Virtuoso's `itemContent` and forces every visible row tree to
  // re-evaluate (defeats `memo` on ChatMessage). `renderRow` is captured by
  // ref so the parent's per-render closure changes don't churn this.
  const renderRowRef = useRef(renderRow);
  renderRowRef.current = renderRow;
  const renderVirtualRow = useCallback(
    (msg: TMessage, index: number, arr: TMessage[]) => (
      // `contain: layout` isolates each row's layout from siblings (so an
      // image decode or reaction update can't reflow the whole list and force
      // Virtuoso to chase with a paddingTop adjustment mid-scroll). We
      // intentionally do NOT add `paint` / `strict` / `content` here — those
      // would establish a containing block for `position: fixed` descendants,
      // which clips the FullscreenImageViewer to a single row instead of the
      // viewport when a chat image is tapped.
      // `data-message-id` is consumed by the e2e regression spec to assert
      // row order and per-row avatar containment under fast upward scroll.
      <div
        className="px-4 pt-4"
        data-message-id={msg.id}
        data-chat-row="true"
        style={{ contain: "layout" }}
      >
        {renderRowRef.current(msg, index, arr)}
      </div>
    ),
    [],
  );

  if (useVirtualized && !searchQuery) {
    return (
      <div
        className="flex-1 min-h-0 overflow-hidden"
        data-chat-virtualized="true"
        style={{ opacity: virtualReady || isPinned ? 1 : 0, transition: "opacity 120ms ease-out" }}
      >
        <VirtualizedChatMessageList
          ref={virtualHandleRef}
          messages={messages}
          hasOlder={hasOlderMessages}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={onLoadOlder}
          renderItem={renderVirtualRow}
          topPadding={0}
          bottomPadding={bottomPad}
          scrollerRef={setVirtualScrollerRef}
          initialBottomPinned={virtualReady || isPinned}
        />
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide"
      data-chat-scroll-lock="true"
      ref={scrollAreaRef}
      style={{
        WebkitOverflowScrolling: isNativeIOS ? "auto" : "touch",
        opacity: isPinned ? 1 : 0,
        transition: "opacity 120ms ease-out",
        pointerEvents: isPinned ? "auto" : "none",
        touchAction: "pan-y",
        overflowAnchor: "none",
        scrollbarGutter: "stable",
      }}
    >
      <div className="p-4" style={{ paddingBottom: typeof bottomPad === "number" ? `${bottomPad}px` : bottomPad, overflowAnchor: "none" }}>
        {hasOlderMessages && !searchQuery && (
          <div ref={loadTriggerRef} className="h-1" style={loadTriggerStyle} />
        )}
        {messages.map((msg, index, arr) => (
          <div key={msg.id} className="pt-4" style={{ overflowAnchor: "none" }}>{renderRow(msg, index, arr)}</div>
        ))}
        <div ref={messagesEndRef} id={endElementId} />
      </div>
    </div>
  );
}
