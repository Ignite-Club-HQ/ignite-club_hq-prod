import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  debugAttachScrollerWatcher,
  debugLogAnchor,
  debugLogBottomPin,
  debugLogDuplicate,
  debugLogFirstItemIndex,
  debugLogMeasure,
  debugLogStartReached,
  debugTrackRender,
  isChatVirtDebugEnabled,
} from "./chatVirtDebug";

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
  /**
   * True when the scroller is within `thresholdPx` of the bottom. Used by
   * chat pages to decide whether composer/keyboard reflow should re-pin to
   * the latest message. Returns true if the scroller has not mounted yet
   * (matches the "default to pinning" semantics of the legacy helper).
   */
  isNearBottom: (thresholdPx: number) => boolean;
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

function getMessageDay(value?: string | null) {
  return value ? new Date(value).toDateString() : "";
}

function estimateChatRowHeight<TMessage extends { id: string }>(
  message: TMessage,
  index: number,
  messages: TMessage[],
) {
  const msg = message as TMessage & { author_name?: string | null } & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16; // row wrapper top padding (pt-4)

  if (msg.created_at) {
    const currentDay = getMessageDay(msg.created_at);
    const previousDay = getMessageDay(prev?.created_at);
    if (!previousDay || previousDay !== currentDay) height += 34;
  }

  if (msg.is_system_message) return Math.max(52, height + 36);

  const text = (msg.text || "").trim();
  const hasImage = !!(msg.image_url || msg.imageUrl);
  const hasReply = !!(msg.reply_to || msg.reply_to_id);
  const reactions = Array.isArray(msg.reactions) ? msg.reactions.length : 0;

  // Author / header line. Long author names ("Sam Bond mum of Harry and
  // Otto") wrap to 2 lines on phones — under-counting this is what makes
  // the viewport jolt as older messages mount during back-scroll.
  const authorChars = (msg.author_name ?? "").length;
  height += authorChars > 24 ? 44 : 22;

  if (hasReply) height += 38;
  // Image bubble: ~240-260px frame + padding + spacing. Slightly over-
  // reserving (vs the previous 224) is intentional — under-estimating made
  // Virtuoso shrink paddingTop after image decode, which read as a sudden
  // upward "jump" mid-scroll. Over-reserving causes the row to settle
  // *down* by a few px on hydrate (visually invisible above the fold)
  // instead of the viewport content shifting up.
  if (hasImage) height += 268;

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
  if (reactions) height += 28;
  height += 22; // timestamp / read receipt row

  return Math.max(64, Math.min(640, height));
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

/**
 * Wraps a virtualised row to record render churn (key stability signal) and
 * the first-paint measured height vs the static estimate. Only mounted when
 * `isChatVirtDebugEnabled()` is true, so it has zero cost in production.
 */
function DebugRowProbe({
  messageId,
  estimated,
  children,
}: {
  messageId: string;
  estimated: number | undefined;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  debugTrackRender(messageId);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    debugLogMeasure(messageId, estimated, el.offsetHeight);
  }, [messageId, estimated]);
  return (
    <div ref={ref} data-debug-probe={messageId}>
      {children}
    </div>
  );
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
    scrollerRef,
    initialBottomPinned = true,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const atBottomRef = useRef(true);
  const bottomPinReadyRef = useRef(false);
  // Timestamp of when the initial bottom-pin completed. Used to enforce a
  // "trust window" before any upward pagination fires, so the very first
  // upward gesture never triggers a prepend that visually teleports the
  // viewport to messages the user hasn't scrolled through yet (the
  // "scroll up, stop, then jump higher" symptom on cold open).
  const bottomPinReadyAtRef = useRef(0);
  // Trust window in ms: until this elapses past the bottom-pin completion,
  // `startReached` is suppressed. After expiry, normal upward prefetch
  // resumes.
  const PREPEND_TRUST_WINDOW_MS = 800;
  const messagesLengthRef = useRef(messages.length);
  // Synchronous in-flight guard for `startReached`. The parent's
  // `isLoadingOlder` state flips via setState, so two `startReached` events
  // fired in the same frame on a fast upward flick both see `false` and
  // double-fetch — the prepended page is then merged twice into the data
  // array, producing duplicate IDs and "ghost" rows in Virtuoso.
  const loadingOlderInFlightRef = useRef(false);
  // Once messages.length grows, the prepend has landed — release the guard.
  useEffect(() => {
    if (messages.length > messagesLengthRef.current) {
      loadingOlderInFlightRef.current = false;
    }
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

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
  const bottomPinRevisionRef = useRef(0);
  const anchorRef = useRef<{ baseFirstId: string | null; baseFirstIndex: number }>({
    baseFirstId: newFirstId,
    baseFirstIndex: START_INDEX - messages.length,
  });

  // Pure derivation — no ref mutations during render. Anchor reset (when the
  // baseFirstId is no longer in the data) is moved into a layout effect below
  // so StrictMode / concurrent re-renders cannot double-fire it mid-scroll
  // and snap the viewport while the user is reading history.
  // NOTE: anchor math is computed against the raw `messages` array (not the
  // de-duped one) because the parent's pagination merges land here first; if
  // a duplicate ever slips in we still want the FIRST occurrence (index 0)
  // to be the anchor, which matches `uniqueMessages[0]`.
  const baseFirstId = anchorRef.current.baseFirstId;
  const baseOffset =
    messages.length === 0
      ? 0
      : baseFirstId
      ? messages.findIndex((message) => message.id === baseFirstId)
      : -1;
  const needsAnchorReset = messages.length > 0 && (!baseFirstId || baseOffset === -1);
  const effectiveBaseIndex = needsAnchorReset
    ? START_INDEX - messages.length
    : anchorRef.current.baseFirstIndex;
  const effectiveBaseOffset = needsAnchorReset ? 0 : Math.max(0, baseOffset);
  const firstItemIndex = effectiveBaseIndex - effectiveBaseOffset;
  const bottomPinRevision = bottomPinRevisionRef.current;
  wasEmptyRef.current = messages.length === 0;

  useEffect(() => {
    if (messages.length === 0) {
      anchorRef.current = { baseFirstId: null, baseFirstIndex: START_INDEX };
      return;
    }
    if (needsAnchorReset) {
      const prev = anchorRef.current;
      anchorRef.current = {
        baseFirstId: newFirstId,
        baseFirstIndex: START_INDEX - messages.length,
      };
      bottomPinReadyRef.current = false;
      bottomPinReadyAtRef.current = 0;
      bottomPinRevisionRef.current += 1;
      debugLogAnchor("reset", {
        previousBaseFirstId: prev.baseFirstId,
        newBaseFirstId: newFirstId,
        messagesLen: messages.length,
        newBaseFirstIndex: START_INDEX - messages.length,
      });
    }
  }, [needsAnchorReset, newFirstId, messages.length]);

  // Trace firstItemIndex movement (the dominant signal for "the viewport
  // jumped under me"). Cheap when debug is off.
  useEffect(() => {
    debugLogFirstItemIndex(firstItemIndex, messages.length);
  }, [firstItemIndex, messages.length]);

  // Belt-and-braces: when messages first populate OR the mounted list is
  // reused for another thread, force a bottom pin. `initialTopMostItemIndex`
  // is only honoured on the first mount; thread-to-thread data replacement
  // otherwise preserves the old scrollTop and can render a blank viewport.
  useEffect(() => {
    const last = messages.length - 1;
    if (last < 0) return;
    const jump = (phase: string) => {
      debugLogBottomPin(bottomPinRevision, phase);
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    };
    jump("immediate");
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      jump("raf1");
      r2 = requestAnimationFrame(() => {
        jump("raf2");
        if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
        bottomPinReadyRef.current = true;
      });
    });
    const t = window.setTimeout(() => {
      jump("timeout-200");
      if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
      bottomPinReadyRef.current = true;
    }, 200);
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomPinRevision]);

  const handleStartReached = useCallback(() => {
    if (!bottomPinReadyRef.current) {
      debugLogStartReached(false, "bottom-pin-not-ready");
      return;
    }
    // Trust window: suppress the very first upward fetch right after the
    // initial bottom pin so a cold-open scroll-up cannot trigger a prepend
    // that visually teleports the viewport to older messages the user
    // hasn't scrolled through yet.
    const sincePin = performance.now() - bottomPinReadyAtRef.current;
    if (sincePin < PREPEND_TRUST_WINDOW_MS) {
      debugLogStartReached(false, "trust-window");
      return;
    }
    if (!hasOlder) {
      debugLogStartReached(false, "no-older");
      return;
    }
    if (isLoadingOlder) {
      debugLogStartReached(false, "already-loading");
      return;
    }
    if (loadingOlderInFlightRef.current) {
      debugLogStartReached(false, "in-flight-guard");
      return;
    }
    loadingOlderInFlightRef.current = true;
    debugLogStartReached(true, "fetch");
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
        if (messagesLengthRef.current <= 0) return;
        virtuosoRef.current?.scrollToIndex({
          index: "LAST",
          align: "end",
          behavior,
        });
      },
      scrollToIndex: (index, align = "center") => {
        virtuosoRef.current?.scrollToIndex({ index, align, behavior: "auto" });
      },
      isAtBottom: () => atBottomRef.current,
      isNearBottom: (thresholdPx: number) => {
        const el = scrollerElRef.current;
        if (!el) return true;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= Math.max(0, thresholdPx);
      },
    }),
    [],
  );

  // O(1) id → index map AND defensive de-duplication. Pagination races (two
  // `startReached` events firing before React flushes `isLoadingOlder=true`)
  // can land the same older page twice, producing duplicate IDs in the array.
  // Virtuoso would then render a "ghost" duplicate row whose key collides
  // with a sibling. Filter out any second occurrence here so the list the
  // virtualiser sees is always strictly unique.
  const { uniqueMessages, indexById } = useMemo(() => {
    const map = new Map<string, number>();
    const unique: TMessage[] = [];
    const dupCounts = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      const id = messages[i].id;
      if (map.has(id)) {
        dupCounts.set(id, (dupCounts.get(id) ?? 1) + 1);
        continue;
      }
      map.set(id, unique.length);
      unique.push(messages[i]);
    }
    if (dupCounts.size > 0 && isChatVirtDebugEnabled()) {
      for (const [id, count] of dupCounts) debugLogDuplicate(id, count);
    }
    return { uniqueMessages: unique, indexById: map };
  }, [messages]);

  const heightEstimates = useMemo(
    () => uniqueMessages.map((message, index) => estimateChatRowHeight(message, index, uniqueMessages)),
    [uniqueMessages],
  );

  // CRITICAL flicker fix: keep `itemContent` identity stable across messages
  // mutations. If this callback's identity changes when an older page lands,
  // Virtuoso re-invokes it for every visible row, defeating React.memo on
  // ChatMessage and producing a full-row repaint flash mid-scroll. We capture
  // the per-render data into refs and reference them inside a callback that
  // is created ONCE per component instance.
  const renderItemRef = useRef(renderItem);
  const uniqueMessagesRef = useRef(uniqueMessages);
  const indexByIdRef = useRef(indexById);
  const heightEstimatesRef = useRef(heightEstimates);
  useLayoutEffect(() => {
    renderItemRef.current = renderItem;
    uniqueMessagesRef.current = uniqueMessages;
    indexByIdRef.current = indexById;
    heightEstimatesRef.current = heightEstimates;
  }, [renderItem, uniqueMessages, indexById, heightEstimates]);

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexByIdRef.current.get(message.id);
      if (idx === undefined) return null;
      const child = renderItemRef.current(message, idx, uniqueMessagesRef.current);
      if (!isChatVirtDebugEnabled()) return child;
      const estimated = idx >= 0 ? heightEstimatesRef.current[idx] : undefined;
      return (
        <DebugRowProbe messageId={message.id} estimated={estimated}>
          {child}
        </DebugRowProbe>
      );
    },
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);


  // Use Virtuoso's default measurement (offsetHeight). Earlier we tried
  // `getBoundingClientRect().height` for "sub-pixel accuracy", but on devices
  // with fractional device-pixel ratios (most Android phones) the bounding
  // rect oscillates by ~0.5px between paints during momentum scrolling.
  // Virtuoso re-applies paddingTop on every change, which is exactly the
  // "shake on fast scroll" symptom. Integer offsetHeight is stable.


  // Use Virtuoso's default measurement (offsetHeight). Earlier we tried
  // `getBoundingClientRect().height` for "sub-pixel accuracy", but on devices
  // with fractional device-pixel ratios (most Android phones) the bounding
  // rect oscillates by ~0.5px between paints during momentum scrolling.
  // Virtuoso re-applies paddingTop on every change, which is exactly the
  // "shake on fast scroll" symptom. Integer offsetHeight is stable.

  // Stable Header/Footer identities. Recreating these on every
  // `bottomPadding` change (which churns whenever the composer remeasures —
  // e.g. ResizeObserver fires while the user is scrolling history) makes
  // Virtuoso unmount/remount its Footer and re-apply paddingBottom, which
  // can cascade into a row-level repaint flash. We reference the live
  // padding values via refs so the footer reads the latest value without
  // changing component identity.
  const topPaddingRef = useRef(topPadding);
  const bottomPaddingRef = useRef(bottomPadding);
  topPaddingRef.current = topPadding;
  bottomPaddingRef.current = bottomPadding;
  const components = useMemo(
    () => ({
      Scroller: ChatVirtuosoScroller,
      // Keep the list header purely structural and independent of loading
      // state. Rendering the spinner here makes Virtuoso re-measure header
      // content exactly while it is trying to preserve a top anchor.
      Header: () => <div style={{ height: topPaddingRef.current, overflowAnchor: "none" }} />,
      Footer: () => <div style={{ height: bottomPaddingRef.current }} />,
    }),
    [],
  );

  // Attach a debug watcher to Virtuoso's real scroll element so we can flag
  // foreign `scrollTop` writes (legacy chat hooks fighting Virtuoso for
  // ownership of the same scroller — the canonical cause of "rows stacking
  // on top of each other" on fast scroll).
  const wrappedScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      // Track the scroll element for the imperative `isNearBottom` API.
      // Window targets don't apply for the inline Virtuoso scroller, so we
      // only retain HTMLElement instances.
      scrollerElRef.current = element instanceof HTMLElement ? element : null;
      debugAttachScrollerWatcher(element);
      scrollerRef?.(element);
    },
    [scrollerRef],
  );

  return (
    <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={uniqueMessages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={{ index: "LAST", align: "end", behavior: "auto" }}
      // NOTE: `alignToBottom` was removed. With anchored prepends
      // (`firstItemIndex` shifting backwards by the page size), `alignToBottom`
      // pins the BOTTOM of the viewport when content grows above the current
      // scroll position. The visible result is exactly the reported symptom:
      // user scrolls up, hits the top of the loaded set, the older page lands
      // ~1–2s later, and the viewport "jumps higher" to messages they never
      // scrolled through — because the bottom-anchor lets the topmost visible
      // row swap to a much older one. The initial-mount bottom pin is already
      // handled by `initialTopMostItemIndex={LAST, end}` and the belt-and-
      // braces `scrollToIndex` effect, so `alignToBottom` is not needed for
      // first-paint and actively breaks anchored pagination.
      startReached={handleStartReached}
      atBottomStateChange={handleAtBottomChange}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      defaultItemHeight={140}
      heightEstimates={heightEstimates}
      // Upward overscan also acts as the "start-reached" lookahead — Virtuoso
      // fires `startReached` when the first data item mounts, so a larger top
      // window means we kick off the older-page fetch BEFORE the user
      // hard-stops at scrollTop=0. With the previous 600px the fetch only
      // started after the gesture stopped, so the prepend landed 1–2s later
      // and the anchored shift read as the viewport "teleporting" to older
      // messages it never scrolled through. 1400px gives the fetch enough
      // runway to land while the finger is still moving. Bottom kept tight
      // so we don't mount heavy image rows the user is scrolling away from.
      increaseViewportBy={{ top: 1400, bottom: 200 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      components={components}
    />
  );
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
