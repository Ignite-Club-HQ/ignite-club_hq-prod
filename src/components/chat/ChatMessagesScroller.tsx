import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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

  const bottomPad = searchOpen
    ? 32
    : isKeyboardOpen
    ? Math.max(128, composerHeight + 40)
    : Math.max(160, composerHeight + 48);

  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const setVirtualScrollerRef = useCallback((element: HTMLElement | null) => {
    (scrollAreaRef as React.MutableRefObject<HTMLDivElement | null>).current = element as HTMLDivElement | null;
  }, [scrollAreaRef]);

  // When the keyboard opens/closes or the composer grows, the viewport
  // resizes underneath the virtualised list. If the user was at the bottom
  // we must re-pin to the latest message — otherwise the most recent
  // messages get hidden behind the keyboard and they "can't see what they
  // just sent". Fires immediately and again after the keyboard animation.
  useEffect(() => {
    if (!useVirtualized || searchQuery) return;
    const handle = virtualHandleRef.current;
    if (!handle) return;
    if (!handle.isAtBottom()) return;
    handle.scrollToBottom("auto");
    const t1 = window.setTimeout(() => handle.scrollToBottom("auto"), 80);
    const t2 = window.setTimeout(() => handle.scrollToBottom("auto"), 280);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [useVirtualized, searchQuery, isKeyboardOpen, composerHeight, bottomPad]);

  if (useVirtualized && !searchQuery) {
    // CRITICAL: keep per-row wrapper *identical* for every index. Any
    // index-conditional class (e.g. `pt-4` on all-but-first) means the
    // previously-first row gains height the moment older messages prepend,
    // which makes virtuoso shift the viewport. Top spacing is owned by the
    // Header in `VirtualizedChatMessageList`.
    const renderVirtualRow = (msg: TMessage, index: number, arr: TMessage[]) => (
      <div className="px-4 pt-4">
        {renderRow(msg, index, arr)}
      </div>
    );
    return (
      <div
        className="flex-1 min-h-0 overflow-hidden"
        data-chat-virtualized="true"
        style={{ opacity: isPinned ? 1 : 0, transition: "opacity 120ms ease-out" }}
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
      <div className="p-4" style={{ paddingBottom: `${bottomPad}px`, overflowAnchor: "none" }}>
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
