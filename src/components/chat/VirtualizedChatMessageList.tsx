import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

/**
 * Virtualised chat message list.
 *
 * Drop-in replacement for the legacy mapped list used by chat pages, gated
 * behind the `ff:chat-virtualization` feature flag. Designed so the parent's
 * pagination, message data, and per-row JSX stay unchanged.
 *
 * Behaviour parity:
 *  - Mounts pinned to latest message (no upward jolt on cold open).
 *  - Upward infinite pagination via `startReached` (replaces the
 *    IntersectionObserver in `useChatOlderMessagesAnchor`).
 *  - Exact scroll anchor on prepend via virtuoso's `firstItemIndex` shift.
 *  - Auto-scroll to bottom only when the user is already at bottom; while
 *    reading history the parent shows its existing "new message" indicator.
 *  - Stable keys (`computeItemKey`) so reaction/edit updates don't churn
 *    neighbouring rows.
 *  - 1200px upward overscan matches existing prefetch margin.
 *
 * The component intentionally takes a `renderItem(message, index, arr)`
 * function so each chat page can keep its bespoke per-row JSX (date
 * separators, highlight ring, ChatMessage props) without duplication.
 */

export interface VirtualizedChatMessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  isAtBottom: () => boolean;
}

interface Props<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderItem: (message: TMessage, index: number, arr: TMessage[]) => React.ReactNode;
  /** Padding above the first message (e.g. for the "load older" spinner). */
  topPadding?: number;
  /** Padding below the last message (typically composer + safe-area). */
  bottomPadding?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Notified on at-bottom transitions so the parent can drive its FAB. */
  onAtBottomChange?: (atBottom: boolean) => void;
}

function VirtualizedChatMessageListInner<TMessage extends { id: string }>(
  {
    messages,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
    renderItem,
    topPadding = 16,
    bottomPadding = 16,
    className,
    style,
    onAtBottomChange,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);

  // Virtuoso's anchored-prepend trick: keep a sliding `firstItemIndex` that
  // decreases by the count of items prepended on each load. This lets
  // virtuoso preserve the exact viewport without us touching scrollTop.
  const START_INDEX = 1_000_000;
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX - messages.length);
  const lastSeenLengthRef = useRef(messages.length);
  const lastFirstIdRef = useRef<string | null>(messages[0]?.id ?? null);

  useEffect(() => {
    const prevLength = lastSeenLengthRef.current;
    const prevFirstId = lastFirstIdRef.current;
    const newFirstId = messages[0]?.id ?? null;

    if (messages.length > prevLength && prevFirstId && newFirstId && prevFirstId !== newFirstId) {
      // Older messages were prepended — shift the index baseline so the
      // current viewport stays anchored to the same row.
      const prependedCount = messages.length - prevLength;
      setFirstItemIndex((idx) => idx - prependedCount);
    } else if (messages.length < prevLength) {
      // Reset (e.g. thread switch) — re-anchor to the new tail.
      setFirstItemIndex(START_INDEX - messages.length);
    }

    lastSeenLengthRef.current = messages.length;
    lastFirstIdRef.current = newFirstId;
  }, [messages]);

  const handleStartReached = useCallback(() => {
    if (!hasOlder || isLoadingOlder) return;
    onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  const handleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    },
    [onAtBottomChange],
  );

  // Only auto-follow new outgoing messages when the user is already at the
  // bottom — never yank a finger reading history.
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = "auto") => {
        const last = lastSeenLengthRef.current - 1;
        if (last < 0) return;
        virtuosoRef.current?.scrollToIndex({
          index: last,
          align: "end",
          behavior,
        });
      },
      scrollToIndex: (index, align = "center") => {
        virtuosoRef.current?.scrollToIndex({ index, align, behavior: "auto" });
      },
      isAtBottom: () => atBottomRef.current,
    }),
    [],
  );

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const localIndex = messages.indexOf(message);
      // Fallback to a defensive lookup in case of identity churn between
      // virtuoso's snapshot and our latest array — should be rare.
      const idx =
        localIndex >= 0
          ? localIndex
          : messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return null;
      return renderItem(message, idx, messages);
    },
    [messages, renderItem],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);

  const components = useMemo(
    () => ({
      Header: () =>
        hasOlder || isLoadingOlder ? (
          <div
            className="flex items-center justify-center"
            style={{ height: isLoadingOlder ? 32 : topPadding, overflowAnchor: "none" }}
            aria-hidden={!isLoadingOlder}
          >
            {isLoadingOlder ? (
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 border-t-transparent animate-spin" />
            ) : null}
          </div>
        ) : (
          <div style={{ height: topPadding }} />
        ),
      Footer: () => <div style={{ height: bottomPadding }} />,
    }),
    [hasOlder, isLoadingOlder, topPadding, bottomPadding],
  );

  return (
    <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style }}
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      startReached={handleStartReached}
      atBottomStateChange={handleAtBottomChange}
      followOutput={followOutput}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      increaseViewportBy={{ top: 1200, bottom: 600 }}
      atBottomThreshold={120}
      components={components}
      // Avoid scroll-anchoring fighting virtuoso's own anchoring on iOS.
      overscan={{ main: 600, reverse: 1200 }}
    />
  );
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
