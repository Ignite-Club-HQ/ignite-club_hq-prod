import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ComponentProps,
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
  bottomPadding?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Notified on at-bottom transitions so the parent can drive its FAB. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Exposes Virtuoso's real scroll element to legacy chat scroll hooks. */
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  /** Parent's initial-pin state; prevents reveal before legacy pin completed. */
  initialBottomPinned?: boolean;
}

type EstimableChatMessage = {
  text?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  created_at?: string | null;
  reply_to?: unknown;
  reply_to_id?: string | null;
  reactions?: unknown[] | null;
  is_system_message?: boolean | null;
};

function estimateChatRowHeight<TMessage extends { id: string }>(
  message: TMessage,
  index: number,
  messages: TMessage[],
) {
  const msg = message as TMessage & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16; // row wrapper top padding

  if (msg.created_at) {
    const currentDay = new Date(msg.created_at).toDateString();
    const previousDay = prev?.created_at ? new Date(prev.created_at).toDateString() : null;
    if (!previousDay || previousDay !== currentDay) height += 34;
  }

  if (msg.is_system_message) return Math.max(52, height + 36);

  const text = (msg.text || "").trim();
  const hasImage = !!(msg.image_url || msg.imageUrl);
  const hasReply = !!(msg.reply_to || msg.reply_to_id);
  const reactions = Array.isArray(msg.reactions) ? msg.reactions.length : 0;

  height += 22; // author/header line or reserved name row
  if (hasReply) height += 38;
  if (hasImage) height += 208; // fixed 240x180 media frame + bubble padding

  if (text) {
    const visibleText = text
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[(event|poll|board|vault|vaultfolder|gallery):[^\]]+\]/gi, "")
      .trim();
    const lineCount = Math.max(1, Math.ceil((visibleText.length || text.length) / 28));
    height += Math.min(10, lineCount) * 20 + 18;
  } else if (!hasImage) {
    height += 42;
  }

  const previewMatches = text.match(/https?:\/\/|www\.|\[(event|poll|board|vault|vaultfolder|vaultroot|gallery):/gi)?.length ?? 0;
  if (previewMatches) height += Math.min(2, previewMatches) * 116;
  if (reactions) height += 24;
  height += 20; // timestamp / read receipt row

  return Math.max(64, Math.min(560, height));
}

const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, scrollerRef) => (
    <div
      {...props}
      ref={scrollerRef}
      data-chat-scroll-lock="true"
      style={{
        ...style,
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

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
    scrollerRef,
    initialBottomPinned = true,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;

  // Virtuoso's anchored-prepend trick: keep `firstItemIndex` tied to the
  // message that was first visible when this data set was established. This
  // is deterministic for a given `messages` array: prepends move the base
  // message to a larger data index, so we subtract that offset; appends do not
  // move it, so the first item index stays unchanged. The previous incremental
  // ref-diff approach could still double-shift under aborted/concurrent renders
  // and produced duplicate rows / shake after fast scrolls.
  const START_INDEX = 1_000_000;
  const newFirstId = messages[0]?.id ?? null;
  const wasEmptyRef = useRef(messages.length === 0);
  const anchorRef = useRef<{ baseFirstId: string | null; baseFirstIndex: number }>({
    baseFirstId: newFirstId,
    baseFirstIndex: START_INDEX - messages.length,
  });

  let justInitiallyPopulated = false;
  if (messages.length === 0) {
    anchorRef.current = { baseFirstId: null, baseFirstIndex: START_INDEX };
  } else {
    const baseFirstId = anchorRef.current.baseFirstId;
    const baseOffset = baseFirstId ? messages.findIndex((message) => message.id === baseFirstId) : -1;
    if (!baseFirstId || baseOffset === -1) {
      justInitiallyPopulated = wasEmptyRef.current;
      anchorRef.current = {
        baseFirstId: newFirstId,
        baseFirstIndex: START_INDEX - messages.length,
      };
    }
  }
  const anchorOffset = anchorRef.current.baseFirstId
    ? messages.findIndex((message) => message.id === anchorRef.current.baseFirstId)
    : 0;
  const firstItemIndex = anchorRef.current.baseFirstIndex - Math.max(0, anchorOffset);
  wasEmptyRef.current = messages.length === 0;

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
        const last = messagesLengthRef.current - 1;
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

  // Fast flicks through image-heavy history used to expose rows after
  // Virtuoso had estimated them as tiny text bubbles, then jump once the real
  // image rows measured. Supplying per-row estimates keeps the scroll range
  // close before mount, so stopping a fast scroll does not re-anchor visibly.
  const heightEstimates = useMemo(
    () => messages.map((message, index) => estimateChatRowHeight(message, index, messages)),
    [messages],
  );

  // Use layout height instead of getBoundingClientRect height. The default
  // measurement can include transient transforms/paint-state changes in rich
  // bubbles; offsetHeight stays tied to actual layout, reducing scroll-time
  // remeasurement noise.
  const itemSize = useCallback((el: HTMLElement) => {
    return Math.ceil(el.offsetHeight || el.getBoundingClientRect().height);
  }, []);

  const components = useMemo(
    () => ({
      Scroller: ChatVirtuosoScroller,
      // Keep the list header purely structural and independent of loading
      // state. Rendering the spinner here makes Virtuoso re-measure header
      // content exactly while it is trying to preserve a top anchor.
      Header: () => <div style={{ height: topPadding, overflowAnchor: "none" }} />,
      Footer: () => <div style={{ height: bottomPadding }} />,
    }),
    [topPadding, bottomPadding],
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
      atBottomStateChange={handleAtBottomChange}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // Estimate so off-screen rows reserve realistic space; otherwise
      // virtuoso uses tiny placeholders that grow on mount and shift the
      // scrollbar/scrollTop while the user is scrolling.
      defaultItemHeight={112}
      heightEstimates={heightEstimates}
      // Keep a generous upward viewport for smooth back-scrolling. Don't
      // also set `overscan` — virtuoso applies both and the interaction
      // produces visible re-anchor jumps on slow devices.
      increaseViewportBy={{ top: 1200, bottom: 600 }}
      minOverscanItemCount={{ top: 12, bottom: 8 }}
      atBottomThreshold={120}
      scrollerRef={scrollerRef}
      components={components}
    />
  );
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
