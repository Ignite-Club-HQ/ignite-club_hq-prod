import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
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
  const isScrollingRef = useRef(false);
  const loadOlderAfterScrollRef = useRef(false);

  // Virtuoso's anchored-prepend trick: keep a sliding `firstItemIndex` that
  // decreases by the count of items prepended. CRITICAL: this MUST be
  // computed during render (not in useEffect), otherwise virtuoso renders
  // one frame with new data + stale index, snapping the viewport when the
  // effect catches up. We use refs to track the previous snapshot and
  // adjust during render.
  const START_INDEX = 1_000_000;
  const firstIndexRef = useRef(START_INDEX - messages.length);
  const lastSeenLengthRef = useRef(messages.length);
  const lastFirstIdRef = useRef<string | null>(messages[0]?.id ?? null);

  const newFirstId = messages[0]?.id ?? null;
  const justInitiallyPopulated =
    lastSeenLengthRef.current === 0 && messages.length > 0;
  if (justInitiallyPopulated) {
    // First real data after an empty mount (notification cold-open, thread
    // switch, etc.) — re-anchor so `initialTopMostItemIndex` lands us on
    // the latest message instead of treating the load as a tail-append.
    firstIndexRef.current = START_INDEX - messages.length;
  } else if (
    messages.length > lastSeenLengthRef.current &&
    lastFirstIdRef.current &&
    newFirstId &&
    lastFirstIdRef.current !== newFirstId
  ) {
    // Older messages prepended — slide the index baseline so the current
    // viewport stays anchored to the same row.
    firstIndexRef.current -= messages.length - lastSeenLengthRef.current;
  } else if (messages.length < lastSeenLengthRef.current) {
    // Reset (thread switch / clear).
    firstIndexRef.current = START_INDEX - messages.length;
  } else if (
    messages.length === lastSeenLengthRef.current &&
    lastFirstIdRef.current !== newFirstId &&
    newFirstId !== null
  ) {
    // Whole list replaced (e.g. reload) at the same length — re-anchor.
    firstIndexRef.current = START_INDEX - messages.length;
  }
  lastSeenLengthRef.current = messages.length;
  lastFirstIdRef.current = newFirstId;
  const firstItemIndex = firstIndexRef.current;

  // Belt-and-braces: when messages first populate, force a scroll-to-bottom
  // on the next two frames. `initialTopMostItemIndex` is only honoured on
  // the very first render; if data arrives a tick later (the common case
  // for notification-launched threads), we have to drive it ourselves.
  useEffect(() => {
    if (!justInitiallyPopulated) return;
    const last = messages.length - 1;
    if (last < 0) return;
    const jump = () =>
      virtuosoRef.current?.scrollToIndex({
        index: last,
        align: "end",
        behavior: "auto",
      });
    jump();
    const r1 = requestAnimationFrame(() => {
      jump();
      const r2 = requestAnimationFrame(jump);
      (jump as unknown as { _r2?: number })._r2 = r2;
    });
    const t = window.setTimeout(jump, 200);
    return () => {
      cancelAnimationFrame(r1);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justInitiallyPopulated]);

  const handleStartReached = useCallback(() => {
    if (!hasOlder || isLoadingOlder) return;
    // Prepending older messages while the finger/momentum scroll is active is
    // the main source of visible upward-scroll jitter: Virtuoso correctly
    // re-anchors, but that re-measure still fights the in-progress gesture.
    // Queue the fetch until scrolling settles so the list moves only under
    // user input during the gesture.
    if (isScrollingRef.current) {
      loadOlderAfterScrollRef.current = true;
      return;
    }
    onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  const handleIsScrollingChange = useCallback(
    (scrolling: boolean) => {
      isScrollingRef.current = scrolling;
      if (scrolling || !loadOlderAfterScrollRef.current) return;
      loadOlderAfterScrollRef.current = false;
      if (!hasOlder || isLoadingOlder) return;
      onLoadOlder();
    },
    [hasOlder, isLoadingOlder, onLoadOlder],
  );

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

  // O(1) id → index map so itemContent doesn't run an O(n) scan per row on
  // every render (which on a 500-message thread is 250k comparisons per
  // re-render and shows up as scroll jank / row flicker).
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) m.set(messages[i].id, i);
    return m;
  }, [messages]);

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexById.get(message.id);
      if (idx === undefined) return null;
      return renderItem(message, idx, messages);
    },
    [messages, renderItem, indexById],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);

  // Use layout height instead of getBoundingClientRect height. The default
  // measurement can include transient transforms/paint-state changes in rich
  // bubbles; offsetHeight stays tied to actual layout, reducing scroll-time
  // remeasurement noise.
  const itemSize = useCallback((el: HTMLElement) => {
    return Math.ceil(el.offsetHeight || el.getBoundingClientRect().height);
  }, []);

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
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      startReached={handleStartReached}
      isScrolling={handleIsScrollingChange}
      atBottomStateChange={handleAtBottomChange}
      followOutput={followOutput}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // Estimate so off-screen rows reserve realistic space; otherwise
      // virtuoso uses tiny placeholders that grow on mount and shift the
      // scrollbar/scrollTop while the user is scrolling.
      defaultItemHeight={88}
      // Keep a generous upward viewport for smooth back-scrolling. Don't
      // also set `overscan` — virtuoso applies both and the interaction
      // produces visible re-anchor jumps on slow devices.
      increaseViewportBy={{ top: 1200, bottom: 600 }}
      minOverscanItemCount={{ top: 12, bottom: 8 }}
      atBottomThreshold={120}
      skipAnimationFrameInResizeObserver
      components={components}
    />
  );
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
