import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  /** Current user id, used only for row-height estimates (own messages have no author label). */
  currentUserId?: string | null;
}

type EstimableChatMessage = {
  author_id?: string | null;
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

// Approx characters that fit on one line of a chat bubble at the current
// viewport. Bubble max-width ≈ 75% of viewport, ~7.2px per char at 14px body
// font. Memoised lazily so we don't read window on every estimate call.
let __cachedCharsPerLine = 0;
let __cachedViewportWidth = 0;
function getCharsPerLine() {
  const w = typeof window !== "undefined" ? window.innerWidth : 411;
  if (w !== __cachedViewportWidth) {
    __cachedViewportWidth = w;
    // Bubble inner width ≈ (viewport - 32px outer padding) * 0.75 - 24px bubble padding.
    const bubbleInner = Math.max(140, (w - 32) * 0.75 - 24);
    __cachedCharsPerLine = Math.max(16, Math.floor(bubbleInner / 7.2));
  }
  return __cachedCharsPerLine;
}

// Per-token-type reserved heights for inline link/preview cards. Real cards
// vary 96–220px; over-reserving is safer than under (Virtuoso shrinks
// paddingTop on under-estimates which reads as an upward jolt mid-scroll).
// Per-token-type reserved heights. Tuned from production drift telemetry
// (see /admin/chat-virt-debug). Conservative: under-reserving causes the
// upward "jolt" symptom; over-reserving leaves harmless extra padding.
// Note: under-reserving causes upward jolts (Virtuoso grows paddingTop after
// measure, pushing the viewport down); over-reserving causes downward jolts
// (paddingTop shrinks, viewport slides up). Production telemetry showed the
// previous defaults were systematically over-reserving by 90-130px on URL
// previews and 30-40px on text bubbles, which read as a continuous upward
// drift during fast upward flicks.
const PREVIEW_HEIGHT_BY_TOKEN: Record<string, number> = {
  event: 200,
  poll: 180,
  board: 160,
  vault: 96,
  vaultfolder: 96,
  vaultroot: 96,
  gallery: 180,
  url: 100,
};

function estimateChatRowHeight<TMessage extends { id: string }>(
  message: TMessage,
  index: number,
  messages: TMessage[],
  currentUserId?: string | null,
) {
  const msg = message as TMessage & {
    author_name?: string | null;
    edited_at?: string | null;
    is_edited?: boolean | null;
  } & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16; // row wrapper top padding (pt-4)

  if (msg.created_at) {
    const currentDay = getMessageDay(msg.created_at);
    const previousDay = getMessageDay(prev?.created_at);
    // ChatDateSeparator is `my-4` (32px) plus a small pill (~24px).
    // Under-estimating separator rows is a common cause of Virtuoso applying
    // a late upward correction when an upward fling settles.
    if (!previousDay || previousDay !== currentDay) height += 56;
  }

  if (msg.is_system_message) return Math.max(52, height + 36);

  const text = (msg.text || "").trim();
  const hasImage = !!(msg.image_url || msg.imageUrl);
  const hasReply = !!(msg.reply_to || msg.reply_to_id);
  const reactions = Array.isArray(msg.reactions) ? msg.reactions.length : 0;

  // Author / header line. ChatMessage hides the author name when the
  // previous visible row is from the SAME author within a short window
  // (consecutive bubbles are grouped). Mirror that here — counting an
  // always-present 24px header was the dominant -34px over-estimate seen
  // in production telemetry.
  const isOwnMessage = !!currentUserId && msg.author_id === currentUserId;
  const sameAuthorAsPrev =
    !!prev &&
    !prev.is_system_message &&
    !!msg.author_id &&
    prev.author_id === msg.author_id &&
    // Same calendar day — date separator above breaks the group.
    getMessageDay(msg.created_at) === getMessageDay(prev.created_at);
  const showAuthorHeader = !isOwnMessage && !sameAuthorAsPrev;
  if (showAuthorHeader) {
    const authorChars = (msg.author_name ?? "").length;
    // Avatar + name + spacing in ChatMessage measures ~40px (or ~56 when the
    // name wraps). Telemetry showed the previous 22/44 values produced a
    // consistent +16px under-reservation on non-grouped rows.
    height += authorChars > 24 ? 56 : 40;
  }

  // ReplyIndicator renders ~44px including its bottom margin in practice.
  if (hasReply) height += 44;
  // Image bubble: aspect-square frame at width=240 → 240px image + caption
  // padding + bubble chrome. Slightly over-reserving keeps the row from
  // shrinking after image decode.
  if (hasImage) height += 320;

  // Strip mention pills and embed tokens before counting visible text length.
  const visibleText = text
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery):[^\]]+\]/gi, "")
    .trim();

  if (visibleText) {
    const charsPerLine = getCharsPerLine();
    const explicitLines = visibleText.split(/\n/);
    let lineCount = 0;
    for (const line of explicitLines) {
      lineCount += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    // ~19px per visual line — telemetry showed 20 was a touch hot on long
    // messages (caused -44/-52/-76 over-estimates).
    height += Math.min(12, lineCount) * 19;
  } else if (!hasImage) {
    height += 32;
  }

  // Inline preview cards. Match each token type separately so per-type
  // reserved heights are accurate.
  const tokenMatches = text.matchAll(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery):[^\]]+\]/gi);
  let previewHeight = 0;
  let previewCount = 0;
  for (const match of tokenMatches) {
    if (previewCount >= 3) break;
    const kind = (match[1] || "").toLowerCase();
    previewHeight += PREVIEW_HEIGHT_BY_TOKEN[kind] ?? 96;
    previewCount += 1;
  }
  // Generic URL previews (only count once per message — we render at most one).
  if (previewCount < 3 && /https?:\/\/|www\./i.test(text)) {
    previewHeight += PREVIEW_HEIGHT_BY_TOKEN.url;
  }
  height += previewHeight;

  // Reactions row wraps every ~4 chips on a phone-width bubble.
  if (reactions) height += Math.ceil(reactions / 4) * 28;

  // Timestamp row + bubble vertical padding (py-2 top/bot ~16px) + row gap.
  // Telemetry consistently showed +28px under-reservation across every basic
  // text bubble — the previous 10px collapsed too much when the timestamp
  // row, edited indicator and bubble chrome were added back.
  height += 28;
  if (msg.edited_at || msg.is_edited) height += 4;

  // Allow taller rows now that long messages and stacked previews are real.
  return Math.max(56, Math.min(960, height));
}

const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, scrollerRef) => (
    <div
      {...props}
      ref={scrollerRef}
      data-chat-scroll-lock="true"
      data-chat-virtualized="true"
      className={`${(props as any).className ?? ""} scrollbar-hide`}
      style={{
        ...style,
        overscrollBehaviorY: "contain",
        // Promote the scroller to its own compositor layer so momentum
        // scrolling on iOS/Android WebViews doesn't repaint sibling DOM each
        // frame. Without this, fast upward flicks repaint the chat header
        // and composer alongside the scroller, which reads as jitter.
        transform: "translateZ(0)",
        willChange: "scroll-position",
        // iOS WebKit momentum scrolling. Harmless on Android/Chromium.
        WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

// Custom Item wrapper that applies CSS containment to each virtualised row.
// This is the single biggest win for fast upward scrolls on native: when a
// row mounts it can no longer invalidate ancestor layout/paint, so the
// 1400px upward overscan (which mounts many rows during a fast flick) stops
// causing main-thread layout thrash.
const ChatVirtuosoItem = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, itemRef) => (
    <div
      {...props}
      ref={itemRef}
      data-chat-virtuoso-item="true"
      style={{
        ...style,
        contain: "content",
      }}
    />
  ),
);
ChatVirtuosoItem.displayName = "ChatVirtuosoItem";

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

/**
 * Lightweight skeleton overlay shown briefly while a deep-link / jump-to-
 * message is hydrating. Uses semantic tokens so it follows the active theme,
 * and `pointer-events-none` so the user can still scroll/tap underneath if
 * they want to abort.
 */
function JumpHydrationSkeleton() {
  const rows = [82, 64, 96, 72, 88, 60, 78];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6 animate-in fade-in duration-150"
      style={{
        background:
          "linear-gradient(to bottom, hsl(var(--background) / 0.92), hsl(var(--background) / 0.98))",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      {rows.map((width, i) => (
        <div
          key={i}
          className="flex"
          style={{ justifyContent: i % 2 === 0 ? "flex-start" : "flex-end" }}
        >
          <div
            className="h-10 rounded-2xl bg-muted animate-pulse"
            style={{ width: `${width}%`, maxWidth: "75%" }}
          />
        </div>
      ))}
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
    currentUserId,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const atBottomRef = useRef(true);
  const bottomPinReadyRef = useRef(false);
  const pinnedRevisionRef = useRef<number | null>(null);
  const [initialRevealReady, setInitialRevealReady] = useState(false);
  // Timestamp of when the initial bottom-pin completed. Used to enforce a
  // "trust window" before any upward pagination fires, so the very first
  // upward gesture never triggers a prepend that visually teleports the
  // viewport to messages the user hasn't scrolled through yet (the
  // "scroll up, stop, then jump higher" symptom on cold open).
  const bottomPinReadyAtRef = useRef(0);
  const userHasScrolledAfterPinRef = useRef(false);
  // Trust window in ms: until this elapses past the bottom-pin completion,
  // `startReached` is suppressed. After expiry, normal upward prefetch
  // resumes.
  const PREPEND_TRUST_WINDOW_MS = 800;
  const messagesLengthRef = useRef(messages.length);
  const hasOlderRef = useRef(hasOlder);
  const isLoadingOlderRef = useRef(isLoadingOlder);
  const onLoadOlderRef = useRef(onLoadOlder);
  const startReachedRetryTimerRef = useRef<number | null>(null);
  hasOlderRef.current = hasOlder;
  isLoadingOlderRef.current = isLoadingOlder;
  onLoadOlderRef.current = onLoadOlder;
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

  // Also release the guard whenever the parent's `isLoadingOlder` flag
  // transitions back to `false`. The length-grew effect above ONLY fires on
  // a successful prepend; if an older-page fetch errors, returns zero rows,
  // or hits the 25s abort timeout, `messages.length` never grows and the
  // synchronous guard would otherwise stay `true` forever — silently blocking
  // every subsequent `startReached` with "in-flight-guard" and making the
  // chat appear to stop scrolling at whatever boundary it last reached.
  // This was the root cause of "team admins/coaches can only scroll back to
  // <date>" — one transient older-page failure permanently disabled upward
  // pagination for the rest of the session.
  const prevIsLoadingOlderRef = useRef(isLoadingOlder);
  useEffect(() => {
    if (prevIsLoadingOlderRef.current && !isLoadingOlder) {
      loadingOlderInFlightRef.current = false;
    }
    prevIsLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  useEffect(() => {
    if (hasOlder) return;
    if (startReachedRetryTimerRef.current !== null) {
      window.clearTimeout(startReachedRetryTimerRef.current);
      startReachedRetryTimerRef.current = null;
    }
  }, [hasOlder]);

  useEffect(() => {
    return () => {
      if (startReachedRetryTimerRef.current !== null) {
        window.clearTimeout(startReachedRetryTimerRef.current);
        startReachedRetryTimerRef.current = null;
      }
    };
  }, []);

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
      // CRITICAL: only re-arm the bottom-pin revision when the user is at /
      // near the bottom (or hasn't pinned yet). Otherwise an in-flight
      // refetch / cache replacement that drops the previous baseline id
      // would teleport a user who is reading history straight back to LAST.
      // We still update the anchor itself so subsequent prepends shift
      // `firstItemIndex` correctly from the new baseline.
      const userIsReadingHistory = bottomPinReadyRef.current && !atBottomRef.current;
      if (!userIsReadingHistory) {
        bottomPinReadyRef.current = false;
        bottomPinReadyAtRef.current = 0;
        userHasScrolledAfterPinRef.current = false;
        bottomPinRevisionRef.current += 1;
      }
      debugLogAnchor("reset", {
        previousBaseFirstId: prev.baseFirstId,
        newBaseFirstId: newFirstId,
        messagesLen: messages.length,
        newBaseFirstIndex: START_INDEX - messages.length,
        suppressedRePin: userIsReadingHistory,
      } as Record<string, unknown>);
    }
  }, [needsAnchorReset, newFirstId, messages.length]);

  // Trace firstItemIndex movement (the dominant signal for "the viewport
  // jumped under me"). Cheap when debug is off.
  useEffect(() => {
    debugLogFirstItemIndex(firstItemIndex, messages.length);
  }, [firstItemIndex, messages.length]);

  // Initial bottom pin happens while the wrapper is invisible. Reveal is held
  // until the actual scroll metrics are quiet, not just until a fixed timeout,
  // so first paint cannot show Virtuoso correcting an interim bottom anchor.
  useLayoutEffect(() => {
    const last = messages.length - 1;
    if (last < 0) {
      bottomPinReadyRef.current = false;
      pinnedRevisionRef.current = null;
      setInitialRevealReady(false);
      return;
    }
    if (bottomPinReadyRef.current && pinnedRevisionRef.current === bottomPinRevision) return;
    setInitialRevealReady(false);
    const jump = (phase: string) => {
      // Defensive guard: if the user has already scrolled away from the
      // bottom by the time a deferred jump fires (e.g. a refetch landed and
      // bumped the revision, then the user flicked up before raf2/200ms
      // expired), abort the jump rather than yanking them back.
      if (bottomPinReadyRef.current && !atBottomRef.current && phase !== "immediate") {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-not-at-bottom`);
        return;
      }
      debugLogBottomPin(bottomPinRevision, phase);
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    };
    jump("immediate");
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;
    let cancelled = false;
    let lastMetrics = "";
    const armRevealWhenStable = () => {
      const el = scrollerElRef.current;
      if (!el || cancelled) return;
      const metrics = `${Math.round(el.scrollTop)}:${Math.round(el.scrollHeight)}:${Math.round(el.clientHeight)}`;
      if (metrics !== lastMetrics) {
        lastMetrics = metrics;
        if (revealTimer !== null) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => {
          cancelled = true;
          // Final belt-and-braces re-anchor the frame before we reveal, so any
          // last paddingTop adjustment from overscan-row measurement doesn't
          // visually shift the bottom row at the moment opacity flips to 1.
          virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
          if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
          bottomPinReadyRef.current = true;
          pinnedRevisionRef.current = bottomPinRevision;
          userHasScrolledAfterPinRef.current = false;
          requestAnimationFrame(() => setInitialRevealReady(true));
        }, 320);
      }
      frame = requestAnimationFrame(armRevealWhenStable);
    };
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      if (cancelled) return;
      jump("raf1");
      r2 = requestAnimationFrame(() => {
        if (cancelled) return;
        jump("raf2");
        armRevealWhenStable();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(r1);
      if (r2 !== null) cancelAnimationFrame(r2);
      if (revealTimer !== null) clearTimeout(revealTimer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });

  const handleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    },
    [onAtBottomChange],
  );

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
      debugLogStartReached(false, "trust-window-deferred");
      if (startReachedRetryTimerRef.current === null) {
        startReachedRetryTimerRef.current = window.setTimeout(() => {
          startReachedRetryTimerRef.current = null;
          if (!bottomPinReadyRef.current || !hasOlderRef.current || isLoadingOlderRef.current || loadingOlderInFlightRef.current) return;
          loadingOlderInFlightRef.current = true;
          debugLogStartReached(true, "deferred-fetch");
          onLoadOlderRef.current();
        }, Math.max(0, PREPEND_TRUST_WINDOW_MS - sincePin));
      }
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

  // Belt-and-braces upward pagination trigger. With top overscan,
  // `startReached` can fail to refire after a successful prepend because the
  // rendered range still spans data index 0 — the user scrolls up but
  // Virtuoso never sees a transition INTO the start. `atTopStateChange`
  // fires on every transition into/out of the top edge, so we use it to
  // re-invoke the same load logic. The `handleStartReached` body is fully
  // idempotent (trust window + in-flight guard + `hasOlder` check), so
  // calling it from both paths is safe.
  const handleAtTopStateChange = useCallback(
    (atTop: boolean) => {
      if (!atTop) return;
      handleStartReached();
    },
    [handleStartReached],
  );

  const handleScroll = useCallback(() => {
    if (bottomPinReadyRef.current) {
      userHasScrolledAfterPinRef.current = true;
    }
  }, []);

  // Prepend anchoring is handled entirely by Virtuoso's `firstItemIndex`
  // shift (see anchorRef math above). We deliberately do NOT run a manual
  // scrollTop-restore loop here: writing scrollTop frame-after-frame while
  // Virtuoso is settling its own row-height estimates produces a visible
  // up/down wobble after an upward fling stops ("jitters then lands").

  // Post-reveal "stay pinned" guard. After the initial bottom pin reveals,
  // late-hydrating content (images decoding, link previews mounting, reply
  // quotes inflating, reactions arriving) grows the heights of rows already
  // on screen. Virtuoso's `followOutput` only re-pins when NEW items are
  // appended, not when existing rows resize, so without this the last
  // message visibly drifts downward (or the viewport scrolls up away from
  // it) over the first ~1.2s after open. We watch scrollHeight via a
  // ResizeObserver on the inner content and forcibly re-pin to LAST as long
  // as the user is still at the bottom and hasn't scrolled away.
  useEffect(() => {
    if (!initialRevealReady) return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    let cancelled = false;
    const startedAt = performance.now();
    const STAY_PINNED_MS = 1500;
    let lastScrollHeight = viewport.scrollHeight;

    const repinIfAtBottom = () => {
      if (cancelled) return;
      // Stop once the user has actively scrolled away from the bottom.
      if (userHasScrolledAfterPinRef.current && !atBottomRef.current) return;
      if (!atBottomRef.current) return;
      const sh = viewport.scrollHeight;
      if (sh === lastScrollHeight) return;
      lastScrollHeight = sh;
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    };

    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      repinIfAtBottom();
      if (performance.now() - startedAt > STAY_PINNED_MS) {
        cancelled = true;
        ro.disconnect();
      }
    });
    ro.observe(inner);

    const stopTimer = window.setTimeout(() => {
      cancelled = true;
      ro.disconnect();
    }, STAY_PINNED_MS + 50);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.clearTimeout(stopTimer);
    };
  }, [initialRevealReady, bottomPinRevision]);

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

  // CRITICAL flicker fix: keep `itemContent` identity stable across messages
  // mutations. If this callback's identity changes when an older page lands,
  // Virtuoso re-invokes it for every visible row, defeating React.memo on
  // ChatMessage and producing a full-row repaint flash mid-scroll. We capture
  // the per-render data into refs and reference them inside a callback that
  // is created ONCE per component instance.
  const renderItemRef = useRef(renderItem);
  const uniqueMessagesRef = useRef(uniqueMessages);
  const indexByIdRef = useRef(indexById);
  const currentUserIdRef = useRef(currentUserId);
  useLayoutEffect(() => {
    renderItemRef.current = renderItem;
    uniqueMessagesRef.current = uniqueMessages;
    indexByIdRef.current = indexById;
    currentUserIdRef.current = currentUserId;
  }, [renderItem, uniqueMessages, indexById, currentUserId]);

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexByIdRef.current.get(message.id);
      if (idx === undefined) return null;
      const child = renderItemRef.current(message, idx, uniqueMessagesRef.current);
      if (!isChatVirtDebugEnabled()) return child;
      const estimated = idx >= 0
        ? estimateChatRowHeight(message, idx, uniqueMessagesRef.current, currentUserIdRef.current)
        : undefined;
      return (
        <DebugRowProbe messageId={message.id} estimated={estimated}>
          {child}
        </DebugRowProbe>
      );
    },
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);


  // Force integer measurements. React-Virtuoso's default itemSize uses
  // getBoundingClientRect(), which can oscillate by sub-pixels on fractional
  // DPR phones during momentum scrolling. Each tiny measurement delta causes
  // Virtuoso to mutate paddingTop, which reads as the remaining upward jitter.
  const itemSize = useCallback((el: HTMLElement, field: "offsetHeight" | "offsetWidth") => {
    return field === "offsetHeight" ? el.offsetHeight : el.offsetWidth;
  }, []);

  const components = useMemo(
    () => ({
      Scroller: ChatVirtuosoScroller,
      Item: ChatVirtuosoItem,
      // Keep the list header purely structural and independent of loading
      // state. Rendering the spinner here makes Virtuoso re-measure header
      // content exactly while it is trying to preserve a top anchor.
      Header: () => <div style={{ height: topPadding, overflowAnchor: "none" }} />,
      Footer: () => <div style={{ height: bottomPadding }} />,
    }),
    [topPadding, bottomPadding],
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

  // Brief skeleton overlay while a deep-link/jump-to-message is hydrating.
  // Driven by window CustomEvents from `jumpToMessageInVirtualizedChat` so
  // every chat surface (Team/Group/Club/Broadcast/ClubAdmin/DM) gets the
  // mask without prop-drilling. Masks the visible re-anchor as deferred row
  // sub-content (link previews, replies, reactions) hydrates after scroll.
  const [isJumpHydrating, setIsJumpHydrating] = useState(false);
  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const onStart = () => {
      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }
      setIsJumpHydrating(true);
    };
    const onEnd = () => {
      // Slight delay before hiding so the cross-fade reads as intentional
      // rather than a flash if hydration finishes in <100ms.
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => setIsJumpHydrating(false), 120);
    };
    window.addEventListener("chat:jump-hydration-start", onStart);
    window.addEventListener("chat:jump-hydration-end", onEnd);
    return () => {
      window.removeEventListener("chat:jump-hydration-start", onStart);
      window.removeEventListener("chat:jump-hydration-end", onEnd);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        opacity: initialRevealReady ? 1 : 0,
        transition: initialRevealReady ? "opacity 80ms ease-out" : "none",
      }}
    >
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
      atTopStateChange={handleAtTopStateChange}
      atTopThreshold={400}
      atBottomStateChange={handleAtBottomChange}
      onScroll={handleScroll}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // Tuned to the real median chat row height: most rows fall in the
      // 90–180px band (text bubble + author + timestamp ≈ 90, image rows
      // with the reserved 4/3 frame ≈ 300). 160 is the population median
      // and minimises the magnitude of the post-measure correction Virtuoso
      // applies to unmeasured rows during a fast upward fling.
      defaultItemHeight={160}
      scrollSeekConfiguration={false}
      // Asymmetric overscan: jank on this app is overwhelmingly on UPWARD
      // scrolls into older history (rows that have never mounted, with
      // variable heights). Reserve a wider top viewport so a hard fling
      // (~2000px in <300ms on a phone) lands inside already-measured
      // territory; keep bottom modest because incoming-message growth is
      // already handled by `followOutput`. Bumping `minOverscanItemCount.top`
      // alongside ensures very tall rows (image + reactions ≈ 360px) are
      // pre-mounted by row count, not just by pixel budget.
      increaseViewportBy={{ top: 1600, bottom: 240 }}
      minOverscanItemCount={{ top: 12, bottom: 2 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      components={components}
    />
    {isJumpHydrating ? <JumpHydrationSkeleton /> : null}
    </div>
  );
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
