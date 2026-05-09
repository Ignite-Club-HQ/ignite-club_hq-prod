import { useCallback, useEffect, useRef, type CSSProperties, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { useChatVirtualizationFlag } from "@/hooks/useChatVirtualizationFlag";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";

/**
 * Shared scroller used by Team / Group / Club / Broadcast chat pages.
 *
 * When the virtualisation feature flag is OFF (default) it renders the
 * legacy scrollable div + mapped row list with the exact same DOM and refs
 * the existing chat hooks (`useChatOlderMessagesAnchor`,
 * `useInitialChatBottomPin`, `useChatAutoScrollToLatest`, etc.) rely on.
 *
 * When the flag is ON it swaps in the virtualised list. While in search
 * mode we always fall back to the legacy view because search uses
 * jump-to-message behaviour that relies on the full DOM being mounted.
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

  // Refs the legacy hooks attach to.
  scrollAreaRef: RefObject<HTMLDivElement>;
  loadTriggerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  endElementId?: string;

  /** Forwarded to the load-trigger sentinel for parity with existing code. */
  loadTriggerStyle?: CSSProperties;
}

export function ChatMessagesScroller<TMessage extends { id: string }>(
  props: ChatMessagesScrollerProps<TMessage>,
) {
  const useVirtualized = useChatVirtualizationFlag();
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
  } = props;

  // The composer is a flex sibling that sits below the scroller, so it never
  // overlaps the message list. `bottomPadding` only needs to clear the bottom
  // safe-area / nav bar when the keyboard is closed; when the keyboard is
  // open the OS pushes the composer up and we just want a small gap so the
  // newest message sits flush above the composer (not floating 128px above).
  const bottomPad = searchOpen
    ? 16
    : isKeyboardOpen
    ? 12
    : `calc(var(--bottom-nav-offset, 0px) + 24px)`;

  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
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
    if (useVirtualized && !searchQuery) {
      // Make sure no stale legacy ref points at a now-unmounted Virtuoso
      // scroller from a previous render of this component.
      (scrollAreaRef as MutableRefObject<HTMLDivElement | null>).current = null;
    }
  }, [scrollAreaRef, searchQuery, useVirtualized]);

  // The legacy initial-pin hook is intentionally disabled in virtualized mode,
  // so it never flips `isPinned` / enables top pagination there. Do that once
  // the list has real data; otherwise the wrapper can stay opacity:0 (blank)
  // and `startReached` can be called before the first bottom pin completes.
  const virtualReady = !useVirtualized || !!searchQuery || messages.length > 0;
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
    if (!isReplyOrEditResize && !handle.isAtBottom()) return;
    handle.scrollToBottom("auto");
    const t1 = window.setTimeout(() => handle.scrollToBottom("auto"), 80);
    const t2 = window.setTimeout(() => handle.scrollToBottom("auto"), 280);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
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
      // `contain: layout paint` isolates each row's layout/paint from siblings
      // so an image decode, reaction update, or signed-URL resolve in row N
      // cannot trigger a sibling reflow that Virtuoso then has to chase with
      // a paddingTop adjustment mid-scroll. This is the single biggest fix
      // for "avatars overlap message bubbles" during fast back-scroll.
      <div className="px-4 pt-4" style={{ contain: "layout paint" }}>
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
