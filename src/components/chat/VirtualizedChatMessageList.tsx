import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";
import {
  debugAttachScrollerWatcher,
  debugLogAnchor,
  debugLogBottomPin,
  debugLogEvent,
  debugLogFirstItemIndex,
  debugLogStartReached,
} from "./chatVirtDebug";
import {
  installChatScrollIntentTracking,
  isViewportTouching,
  isViewportUserActive,
} from "@/lib/chatScrollIntent";
import { BasicChatMessageList } from "./BasicChatMessageList";
import { useChatVirtualizationEnabled } from "@/hooks/useChatVirtualizationEnabled";
import { isChatJumpActive, setChatJumpActive } from "@/lib/chatJumpActive";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { waitForChatJumpTargetReveal } from "@/lib/chatJumpReveal";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { chatJumpLifecycleRemaining } from "@/lib/chatJumpLifecycle";
import { getChatBottomPaddingOffset } from "@/lib/chatBottomPadding";
import { createChatRowSignature } from "./chatRowSignature";
import {
  ChatVirtuosoFooter,
  ChatVirtuosoHeader,
  ChatVirtuosoItem,
  ChatVirtuosoScroller,
  type ChatVirtuosoContext,
} from "./ChatVirtuosoChrome";
import {
  escapeChatCssAttributeValue,
  installVirtuosoResizeObserverErrorGuard,
  isAndroidNativeWebView,
} from "./chatVirtuosoEnvironment";
import { ChatJumpHydrationSkeleton } from "./ChatJumpHydrationSkeleton";
import {
  ChatVirtuosoRowAdapter,
  type ChatRowAdapterMessage,
  type ChatRowRender,
} from "./ChatVirtuosoRowAdapter";
import {
  markDeferredPrependUpwardMotion,
  markDeferredPrependUserInput,
  isDeferredPrependUserScrollActive,
  setDeferredPrependScroller,
  setDeferredPrependScrolling,
  useDeferredChatPrepends,
} from "./useDeferredChatPrepends";
import { useChatJumpHydration } from "./useChatJumpHydration";
import { usePreparedChatMessageWindow } from "./usePreparedChatMessageWindow";


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
  scrollToBottom: (behavior?: "auto" | "smooth", options?: { force?: boolean }) => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  scrollToMessageId: (messageId: string, align?: "start" | "center" | "end") => boolean;
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
  /** Mount this message in view immediately for exact notification jumps. */
  initialTargetMessageId?: string | null;
  /** Current user id, used only for row-height estimates (own messages have no author label). */
  currentUserId?: string | null;
}

// `skipAnimationFrameInResizeObserver` (set on <Virtuoso/> below) makes item
// measurement synchronous inside the ResizeObserver callback. The browser
// then legitimately reports the benign "ResizeObserver loop completed with
// undelivered notifications" error (per react-virtuoso docs / issue #1049).
// Swallow ONLY that specific message so it doesn't pollute error overlays
// or monitoring. Installed once at module load.
installVirtuosoResizeObserverErrorGuard();
/**
 * Defers prepended history pages until the user's scroll gesture has gone
 * idle.
 *
 * Virtuoso applies a `paddingTop` correction whenever a freshly prepended
 * row's measured height differs from its estimate. When that correction
 * fires DURING an active flick it fights the browser's momentum scrolling
 * and shows up as flicker / re-anchoring. (Off-screen pre-measure was
 * attempted and reverted: heights measured outside the live Virtuoso item
 * container were systematically wrong, poisoning the row-height cache and
 * causing post-stop jolts.)
 *
 * Instead: when a prepend page arrives while the user is still actively
 * scrolling, hold it. Commit the merge only once the chat viewport has been
 * idle for `PREPEND_IDLE_MS`. Stationary commits let Virtuoso adjust
 * scrollTop + paddingTop atomically with no momentum to fight, so the
 * visible rows stay put.
 *
 * Appends / edits / interleaves always commit immediately — realtime and
 * send paths are never delayed.
 */
// Prepend commit gate.
//
// Commit older pages only inside the same user-driven scroll session that
// requested them. Once Virtuoso reports `isScrolling=false`, every unresolved
// prepend is frozen until the next explicit upward gesture. This closes the
// fast-scroll failure mode where a fetch resolves 50–250ms after inertia ends:
// `firstItemIndex` shifts, Virtuoso measures the new page, and a stationary
// viewport visibly moves down.
function VirtualizedChatMessageListInner<TMessage extends { id: string }>(
  {
    messages: messagesProp,
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
    initialTargetMessageId = null,
    currentUserId,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // Expose this scroller to the module-level prepend gate so it can check
  // whether a finger is currently on the glass before committing a held page.
  useEffect(() => {
    setDeferredPrependScroller(() => scrollerElRef.current);
    return () => {
      setDeferredPrependScroller(null);
    };
  }, []);
  // Prepended history pages are held until the scroll gesture goes idle so
  // Virtuoso's paddingTop correction never fires mid-flick. `messages` below
  // is the committed array — the rest of the body operates on it unchanged.
  const messages = useDeferredChatPrepends(messagesProp);
  const atBottomRef = useRef(true);
  const bottomPinReadyRef = useRef(false);
  const pinnedRevisionRef = useRef<number | null>(null);
  // Tracks which revision currently has an in-flight pin sequence
  // (immediate → raf1 → raf2 → stabilisation). Without this, the
  // depless useLayoutEffect below re-fires `jump("immediate")` on
  // every parent re-render that occurs during the 320ms stabilisation
  // window (Virtuoso paddingTop measurements cause many such renders),
  // flooding telemetry and re-yanking scrollTop.
  const pinAttemptRevisionRef = useRef<number | null>(null);
  const [initialRevealReady, setInitialRevealReady] = useState(false);
  // Timestamp of when the initial bottom-pin completed. Used to enforce a
  // "trust window" before any upward pagination fires, so the very first
  // upward gesture never triggers a prepend that visually teleports the
  // viewport to messages the user hasn't scrolled through yet (the
  // "scroll up, stop, then jump higher" symptom on cold open).
  const bottomPinReadyAtRef = useRef(0);
  const userHasScrolledAfterPinRef = useRef(false);
  // Fresh-login / cold-open safety net: cached messages can mount first, then
  // the fresh query appends the real latest row a moment later. Track the
  // opening window so those first data swaps keep landing on the latest row,
  // unless the user has deliberately started reading history.
  const openPinStartedAtRef = useRef<number | null>(null);
  const openPinLastMessageIdRef = useRef<string | null>(null);
  // Tracks the messages.length seen by the cold-open re-pin guard so it can
  // detect cached→fresh page swaps where lastMessageId is unchanged but
  // older rows get extended/replaced (which still shifts the bottom row).
  const openPinMessagesLengthRef = useRef<number>(-1);
  // Trust window in ms: until this elapses past the bottom-pin completion,
  // `startReached` is suppressed. After expiry, normal upward prefetch
  // resumes.
  const PREPEND_TRUST_WINDOW_MS = 800;
  const messagesLengthRef = useRef(messages.length);
  const hasOlderRef = useRef(hasOlder);
  const isLoadingOlderRef = useRef(isLoadingOlder);
  const onLoadOlderRef = useRef(onLoadOlder);
  
  hasOlderRef.current = hasOlder;
  isLoadingOlderRef.current = isLoadingOlder;
  onLoadOlderRef.current = onLoadOlder;
  // Synchronous in-flight guard for `startReached`. The parent's
  // `isLoadingOlder` state flips via setState, so two `startReached` events
  // fired in the same frame on a fast upward flick both see `false` and
  // double-fetch — the prepended page is then merged twice into the data
  // array, producing duplicate IDs and "ghost" rows in Virtuoso.
  const loadingOlderInFlightRef = useRef(false);
  // `userHasScrolledAfterPinRef` is intentionally sticky for first-open pin
  // suppression, but it must NOT be used as permission to keep paginating.
  // After a fast flick stops, Virtuoso can re-fire `startReached` while it is
  // reconciling prepended row measurements; requiring a very recent upward
  // scroll event prevents those render-owned callbacks from queueing another
  // older-page fetch after the user's thumb/inertia has actually settled.
  const lastObservedScrollTopRef = useRef<number | null>(null);
  const lastUserUpwardScrollAtRef = useRef(0);
  // Tightened from 220 → 100ms: the trailing 120ms of the window was firing
  // `startReached` right as a fast fling decelerated, landing a prepend
  // page just after the user stopped — visible as "rows keep moving after I
  // stop". 100ms still covers a genuine continuous upward gesture (Virtuoso
  // re-fires startReached on every page boundary at ~60fps); it only drops
  // the tail-end fire that has no live finger or live momentum behind it.
  // The edge-pin fallback below still requires an active touch.
  const PREPEND_USER_SCROLL_ACTIVE_MS = 100;
  const hasRecentUserUpwardScroll = useCallback(() => {
    if (performance.now() - lastUserUpwardScrollAtRef.current <= PREPEND_USER_SCROLL_ACTIVE_MS) {
      return true;
    }
    // Edge-pin fallback: once scrollTop hits 0 the browser stops emitting
    // upward scroll deltas. Only treat this as continuing upward intent if a
    // finger is STILL on the glass — using the broader `isViewportUserActive`
    // cooldown (600ms) caused `startReached` to keep firing after release,
    // which surfaced as "messages keep moving after I stopped".
    const el = scrollerElRef.current;
    if (el && el.scrollTop <= 4 && isViewportTouching(el)) return true;
    return false;
  }, []);

  // Min gap between two prepend fetches. After a page lands, fast upward
  // flings can immediately retrigger `startReached` / `atTopStateChange`
  // before the browser has rasterised the newly-mounted rows — producing a
  // visible flicker as Virtuoso prepends a second page on top of an
  // unsettled layout. We enforce a short cooldown so each prepend has time
  // to paint before the next one is allowed.
  // 600ms (was 350ms): on Android WebView a fast upward fling can land a
  // prepend page before the previous one's freshly-mounted rows have
  // rasterised. Stacking two `firstItemIndex` shifts inside that window is
  // the dominant cause of the "flicker on fast scroll-up" reports — the
  // second page's estimate→measured paddingTop correction lands on top of
  // an already-unsettled layout. 600ms gives the previous prepend a full
  // ~36-frame window to settle before another is allowed. Genuine repeat
  // upward gestures past the cooldown still trigger `startReached` /
  // `atTopStateChange` naturally, so this only suppresses the back-to-back
  // case, not normal pagination.
  const PREPEND_COOLDOWN_MS = 600;
  const lastPrependLandedAtRef = useRef(0);
  // Once messages.length grows, the prepend has landed — release the guard.
  useEffect(() => {
    if (messages.length > messagesLengthRef.current) {
      loadingOlderInFlightRef.current = false;
      lastPrependLandedAtRef.current = performance.now();
    }
    // Diagnostic: a wholesale window collapse (e.g. 270 → 100 rows) means a
    // parent replaced the rendered array — the precursor to the post-scroll
    // "teleport to bottom" jolt seen in field telemetry.
    if (messages.length < messagesLengthRef.current - 5) {
      debugLogEvent("window-shrink", {
        prevLen: messagesLengthRef.current,
        nextLen: messages.length,
      });
    }
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Diagnostic: full remounts re-run the initial bottom pin at revision 0 and
  // teleport a history-reading user back to LAST. Log mount/unmount so a
  // field dump can distinguish remount from in-place anchor reset.
  useEffect(() => {
    debugLogEvent("list-mount", { messagesLen: messagesLengthRef.current });
    return () => {
      debugLogEvent("list-unmount", { messagesLen: messagesLengthRef.current });
    };
  }, []);

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
      lastPrependLandedAtRef.current = performance.now();
    }
    prevIsLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);


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
  const [bottomPinRevision, setBottomPinRevision] = useState(0);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
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
  // Memoise the O(n) anchor lookup. Without this it runs on every parent
  // render (200+ comparisons on a typical chat) and during a prepend +
  // Virtuoso measurement burst it can fire 20-40×/s, adding pure main-thread
  // jank to the fast-scroll budget.
  const baseOffset = useMemo(() => {
    if (messages.length === 0) return 0;
    if (!baseFirstId) return -1;
    return messages.findIndex((message) => message.id === baseFirstId);
  }, [messages, baseFirstId]);
  const needsAnchorReset = messages.length > 0 && (!baseFirstId || baseOffset === -1);
  const effectiveBaseIndex = needsAnchorReset
    ? START_INDEX - messages.length
    : anchorRef.current.baseFirstIndex;
  const effectiveBaseOffset = needsAnchorReset ? 0 : Math.max(0, baseOffset);
  const firstItemIndex = effectiveBaseIndex - effectiveBaseOffset;
  const firstItemIndexRef = useRef(firstItemIndex);
  firstItemIndexRef.current = firstItemIndex;
  wasEmptyRef.current = messages.length === 0;
  const latestInitialSettleSignatureRef = useRef("");
  latestInitialSettleSignatureRef.current = `${messages.length}:${lastMessageId ?? ""}:${firstItemIndex}:${String(bottomPadding)}`;
  // Tail id of the list at the moment it was last revealed. Used to tell a
  // "cached/placeholder → authoritative response corrected the head" swap
  // (same tail, already visible: must NOT re-hide) apart from a genuine
  // thread/anchor change.
  const revealedTailIdRef = useRef<string | null>(null);
  const initialRevealReadyRef = useRef(false);
  initialRevealReadyRef.current = initialRevealReady;
  if (initialRevealReady && lastMessageId) revealedTailIdRef.current = lastMessageId;


  const safeScrollToIndex = useCallback(
    (payload: Parameters<VirtuosoHandle["scrollToIndex"]>[0], reason: string) => {
      if (messagesLengthRef.current <= 0) {
        debugLogEvent("scroll-to-index-skipped-empty", { reason });
        return false;
      }
      try {
        virtuosoRef.current?.scrollToIndex(payload);
        return true;
      } catch (error) {
        console.warn("[VirtualizedChatMessageList] scrollToIndex skipped", { reason, error });
        return false;
      }
    },
    [],
  );

  /**
   * Exact-DOM alignment for a mounted row. Single implementation shared by the
   * imperative `scrollToMessageId` handle and the jump reveal fail-safe, so
   * "one final exact-DOM alignment" is guaranteed to be the same correction
   * the jump itself applies.
   */
  const alignMessageIdInView = useCallback(
    (messageId: string, align: "start" | "center" | "end" = "center") => {
      const el = scrollerElRef.current;
      if (!el) return false;
      const escapedId = escapeChatCssAttributeValue(messageId);
      const row = el.querySelector<HTMLElement>(`[data-row-id="${escapedId}"]`);
      if (!row) return false;
      const rowRect = row.getBoundingClientRect();
      const scrollerRect = el.getBoundingClientRect();
      const reservedBottom = align === "end" ? getChatBottomPaddingOffset(bottomPadding) : 0;
      const targetTop =
        align === "end"
          ? el.scrollTop + rowRect.bottom - scrollerRect.bottom + reservedBottom
          : align === "start"
          ? el.scrollTop + rowRect.top - scrollerRect.top
          : el.scrollTop + rowRect.top - scrollerRect.top - Math.max(0, (el.clientHeight - rowRect.height) / 2);
      const previousScrollTop = el.scrollTop;
      el.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      markChatScrollWrite();
      console.log("[jumpToMessage] exact DOM correction", {
        messageId,
        align,
        previousScrollTop,
        targetTop: Math.max(0, targetTop),
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        scrollerTop: scrollerRect.top,
        scrollerBottom: scrollerRect.bottom,
      });
      return true;
    },
    [bottomPadding],
  );

  // Latest-render mirrors for the mount-once jump overlay effect (deps: []).
  const alignMessageIdInViewRef = useRef(alignMessageIdInView);
  alignMessageIdInViewRef.current = alignMessageIdInView;
  const postJumpAnchorRef = useRef<{ id: string; at: number } | null>(null);
  const [jumpAnchorNonce, setJumpAnchorNonce] = useState(0);




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
      // Already-revealed content whose tail is unchanged means this reset is
      // only anchor bookkeeping (a cached/placeholder head being corrected by
      // the authoritative response). Re-arming the pin here would clear the
      // reveal latch and flash an already-populated thread back to a skeleton.
      const alreadyRevealedAndStable =
        initialRevealReadyRef.current &&
        !!lastMessageId &&
        revealedTailIdRef.current === lastMessageId;
      if (!userIsReadingHistory && !alreadyRevealedAndStable) {
        bottomPinReadyRef.current = false;
        bottomPinReadyAtRef.current = 0;
        userHasScrolledAfterPinRef.current = false;
        openPinStartedAtRef.current = null;
        openPinLastMessageIdRef.current = null;
        openPinMessagesLengthRef.current = -1;
        setBottomPinRevision((revision) => revision + 1);
      }
      debugLogAnchor("reset", {
        previousBaseFirstId: prev.baseFirstId,
        newBaseFirstId: newFirstId,
        messagesLen: messages.length,
        newBaseFirstIndex: START_INDEX - messages.length,
        suppressedRePin: userIsReadingHistory || alreadyRevealedAndStable,
      } as Record<string, unknown>);
    }
  }, [needsAnchorReset, newFirstId, messages.length, lastMessageId]);


  // Trace firstItemIndex movement (the dominant signal for "the viewport
  // jumped under me"). Cheap when debug is off.
  useEffect(() => {
    debugLogFirstItemIndex(firstItemIndex, messages.length);
  }, [firstItemIndex, messages.length]);

  // Tracks whether this mount has ever observed a non-empty messages array.
  // Used to distinguish "empty thread (genuinely no messages)" from "first
  // open after fresh login where the cache is cold and messages haven't
  // streamed in yet". In the latter case, revealing the empty viewport at
  // opacity 1 lets the user see the chat surface unpinned; when messages
  // then arrive, the snap-to-LAST is visible as a downward jolt.
  const hasEverHadMessagesRef = useRef(false);
  if (messages.length > 0) hasEverHadMessagesRef.current = true;

  // Initial bottom pin happens while the wrapper is invisible. Reveal is held
  // until the actual scroll metrics are quiet, not just until a fixed timeout,
  // so first paint cannot show Virtuoso correcting an interim bottom anchor.
  useLayoutEffect(() => {
    const last = messages.length - 1;
    if (last < 0) {
      bottomPinReadyRef.current = false;
      pinnedRevisionRef.current = null;
      pinAttemptRevisionRef.current = null;
      // Empty thread on first-ever mount (cold cache after fresh login):
      // hold the reveal back briefly so that if messages stream in within
      // the grace window we go straight into the pin sequence without
      // ever painting an unpinned empty viewport. If the grace expires
      // with still no messages, reveal so the empty-state is visible.
      // Deep-link jump-to-message is unaffected: that path runs through
      // the non-empty branch (messages exist by the time the jump fires)
      // and is gated on `isChatJumpActive()` below.
      if (!initialBottomPinned || hasEverHadMessagesRef.current) {
        setInitialRevealReady(true);
        return;
      }
      const graceTimer = window.setTimeout(() => setInitialRevealReady(true), 700);
      return () => window.clearTimeout(graceTimer);
    }
    // Deep-link jump path (push notification / search / reply / pin tap):
    // when an `initialTargetMessageId` was supplied and its row is already
    // in the loaded set, Virtuoso mounted with
    // `initialTopMostItemIndex={index:target, align:"end"}` — the viewport
    // is ALREADY on the correct row. Running the bottom-pin sequence here
    // would immediately snap to LAST/end (the parent's jump effect that
    // sets `isChatJumpActive` runs AFTER this useLayoutEffect in commit
    // ordering, so the guard above misses on the tap that opens/refocuses
    // the chat), producing the visible "message moves around before
    // settling" jitter reported when tapping a notification for a
    // different message in a chat that's already open at another
    // position. Treat as already-pinned, but do NOT reveal immediately: wait
    // until Virtuoso's row measurement, exact-DOM correction, and any visible
    // row hydration have produced a quiet scroller. This branch must run
    // BEFORE the `!initialBottomPinned` shortcut below because every deep-link
    // page passes `initialBottomPinned={false}`.
    if (initialTargetMessageId && initialTargetIndex >= 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      setInitialRevealReady(false);
      let cancelled = false;
      let cleanup: (() => void) | null = null;
      let revealFrame: number | null = null;
      // ONE lifecycle budget, measured from the ORIGINAL jump start (not from
      // this effect run, which can re-fire on message-window growth). The
      // reveal itself is gated on the exact target being mounted, aligned,
      // unclipped and stationary — see `waitForChatJumpTargetReveal`. This is
      // deliberately the shortest defensible fail-safe: previously we chained a
      // 2.2 s jump tail onto a fresh 6.5 s settle wait (re-armed every 80 ms),
      // which left a correctly aligned thread masked for many seconds.
      const JUMP_REVEAL_FAILSAFE_MS = 4000;
      const finish = () => {
        if (cancelled) return;
        cancelled = true;
        cleanup?.();
        revealFrame = requestAnimationFrame(() => {
          userHasScrolledAfterPinRef.current = false;
          postJumpAnchorRef.current = {
            id: initialTargetMessageId,
            at: performance.now(),
          };
          setJumpAnchorNonce((nonce) => nonce + 1);
          setInitialRevealReady(true);
        });
      };
      const wait = () => {
        if (cancelled) return;
        const scroller = scrollerElRef.current;
        if (!scroller) {
          revealFrame = requestAnimationFrame(wait);
          return;
        }
        cleanup = waitForChatJumpTargetReveal(
          scroller,
          {
            targetMessageId: initialTargetMessageId,
            usableBottomInsetPx: getChatBottomPaddingOffset(bottomPadding),
            quietMs: 240,
            budgetMs: Math.max(
              600,
              chatJumpLifecycleRemaining(JUMP_REVEAL_FAILSAFE_MS),
            ),
            finalAlign: () => { alignMessageIdInView(initialTargetMessageId, "end"); },
          },
          finish,
        );
      };
      wait();
      return () => {
        cancelled = true;
        cleanup?.();
        if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      };
    }


    // Deep-link target requested but its row is NOT in the loaded window yet.
    // Revealing here paints the fallback (bottom/LAST) anchor, and moments
    // later the parent's target-window hydration bumps the scroller key and
    // remounts this list — the user sees content, then a skeleton, then the
    // real target. Stay masked while the target fetch is in flight, bounded by
    // the jump lifecycle budget so a target that never arrives still reveals.
    if (initialTargetMessageId && initialTargetIndex < 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      const TARGET_PENDING_HOLD_MS = 2500;
      const holdMs = Math.max(
        400,
        Math.min(3000, chatJumpLifecycleRemaining(TARGET_PENDING_HOLD_MS)),
      );
      const holdTimer = window.setTimeout(() => setInitialRevealReady(true), holdMs);
      return () => window.clearTimeout(holdTimer);
    }

    if (!initialBottomPinned) {
      bottomPinReadyRef.current = true;
      // Do NOT stamp `pinnedRevisionRef` here. The parent computes
      // `initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}`,
      // which is frequently `false` on the FIRST render of a mount and flips
      // `true` a frame later. Stamping the revision on that transient false
      // pass made the guard below short-circuit the real pin sequence when the
      // prop flipped, so a plain reopen (e.g. straight after posting a
      // message) revealed wherever Virtuoso happened to mount instead of the
      // bottom — and nothing corrected it afterwards.
      pinnedRevisionRef.current = null;
      pinAttemptRevisionRef.current = null;
      setInitialRevealReady(true);
      return;
    }

    if (bottomPinReadyRef.current && pinnedRevisionRef.current === bottomPinRevision) return;
    if (isChatJumpActive()) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      setInitialRevealReady(true);
      return;
    }
    // Skip if a pin sequence for this revision is already in flight — a
    // re-render mid-stabilisation must not retrigger the synchronous
    // `jump("immediate")` below.
    if (pinAttemptRevisionRef.current === bottomPinRevision) return;
    pinAttemptRevisionRef.current = bottomPinRevision;
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
      if (isChatJumpActive()) {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-jump-active`);
        return;
      }
      debugLogBottomPin(bottomPinRevision, phase);
      safeScrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      }, `bottom-pin-${phase}`);
    };
    jump("immediate");
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: number | null = null;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let cancelled = false;
    let disposedAfterReveal = false;
    let lastMetrics = "";
    // Hard deadline for the reveal. On Android, late-hydrating images / link
    // previews / reactions can keep `scrollHeight` ticking for far longer
    // than the 320 ms idle window, which previously left the wrapper at
    // opacity 0 indefinitely AND ran a per-frame rAF the entire time —
    // visible to the user as a frozen, blank chat. After this deadline we
    // reveal regardless and let any remaining reflows happen in plain sight.
    const REVEAL_DEADLINE_MS = 3000;
    const REVEAL_IDLE_MS = 520;
    let visualSettleCleanup: (() => void) | null = null;
    const doReveal = (reason: string) => {
      if (cancelled) return;
      const el = scrollerElRef.current;
      cancelled = true;
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      // Final belt-and-braces re-anchor the frame before we reveal, so any
      // last paddingTop adjustment from overscan-row measurement doesn't
      // visually shift the bottom row at the moment opacity flips to 1.
      if (!isChatJumpActive()) {
        safeScrollToIndex({ index: "LAST", align: "end", behavior: "auto" }, "bottom-pin-reveal-final");
      }
      if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      userHasScrolledAfterPinRef.current = false;
      debugLogBottomPin(bottomPinRevision, `reveal-${reason}`);
      visualSettleCleanup?.();
      visualSettleCleanup = waitForChatVisualContentSettle(el, { quietMs: 520, maxMs: 2400 }, () => {
        if (disposedAfterReveal) return;
        if (isChatJumpActive()) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        if (userHasScrolledAfterPinRef.current && !atBottomRef.current) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        safeScrollToIndex({ index: "LAST", align: "end", behavior: "auto" }, "bottom-pin-settle");
        requestAnimationFrame(() => {
          safeScrollToIndex({ index: "LAST", align: "end", behavior: "auto" }, "bottom-pin-settle-raf");
          setInitialRevealReady(true);
        });
      });
    };
    const armRevealWhenStable = () => {
      const el = scrollerElRef.current;
      if (!el || cancelled) return;
      if (!isChatJumpActive()) {
        safeScrollToIndex({ index: "LAST", align: "end", behavior: "auto" }, "bottom-pin-stability-check");
      }
      const metrics = `${latestInitialSettleSignatureRef.current}:${Math.round(el.scrollTop)}:${Math.round(el.scrollHeight)}:${Math.round(el.clientHeight)}`;
      if (metrics !== lastMetrics) {
        lastMetrics = metrics;
        if (revealTimer !== null) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => doReveal("idle"), REVEAL_IDLE_MS);
      }
      frame = null;
    };
    const scheduleStableCheck = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(armRevealWhenStable);
    };
    const attachStabilityWatchers = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleStableCheck);
        resizeObserver.observe(el);
        const inner = el.firstElementChild;
        if (inner instanceof HTMLElement) resizeObserver.observe(inner);
      }
      mutationObserver = new MutationObserver(scheduleStableCheck);
      mutationObserver.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      deadlineTimer = window.setTimeout(() => doReveal("deadline"), REVEAL_DEADLINE_MS);
      scheduleStableCheck();
    };
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      if (cancelled) return;
      jump("raf1");
      r2 = requestAnimationFrame(() => {
        if (cancelled) return;
        jump("raf2");
        attachStabilityWatchers();
      });
    });
    return () => {
      disposedAfterReveal = true;
      cancelled = true;
      cancelAnimationFrame(r1);
      if (r2 !== null) cancelAnimationFrame(r2);
      if (revealTimer !== null) clearTimeout(revealTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      visualSettleCleanup?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    // Intentionally narrow deps: this effect must NOT re-run on every
    // parent render (Virtuoso paddingTop measurements cause many during
    // the stabilisation window — re-running cancels in-flight rAFs and
    // floods telemetry with redundant `jump("immediate")` calls). It only
    // needs to fire when a new pin revision is requested or when the list
    // transitions between empty / non-empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `initialTargetMessageId` is included so a NEW deep-link target starts a
    // fresh hydration lifecycle (and cancels the previous one) rather than
    // inheriting an already-expired deadline from another notification.
  }, [bottomPinRevision, messages.length === 0, initialBottomPinned, initialTargetMessageId]);

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
    const userInitiatedTopReach = hasRecentUserUpwardScroll();
    // Trust window: suppress the very first upward fetch right after the
    // initial bottom pin so a cold-open scroll-up cannot trigger a prepend
    // that visually teleports the viewport to older messages the user
    // hasn't scrolled through yet.
    const sincePin = performance.now() - bottomPinReadyAtRef.current;
    if (sincePin < PREPEND_TRUST_WINDOW_MS) {
      debugLogStartReached(false, "trust-window-suppressed");
      return;
    }
    if (!userInitiatedTopReach) {
      debugLogStartReached(false, "no-user-scroll");
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
    const sinceLastPrepend = performance.now() - lastPrependLandedAtRef.current;
    if (
      lastPrependLandedAtRef.current > 0 &&
      sinceLastPrepend < PREPEND_COOLDOWN_MS
    ) {
      // Cooldown: a prepend just landed; suppress (do NOT retry). A queued
      // fetch firing after the user stops reads as "messages keep moving
      // after I stopped" — the next genuine upward gesture will retrigger
      // `startReached` naturally.
      debugLogStartReached(false, "cooldown-suppressed");
      return;
    }
    loadingOlderInFlightRef.current = true;
    debugLogStartReached(true, "fetch");
    onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder, hasRecentUserUpwardScroll]);

  // When the scroller is already pinned at scrollTop≈0, iOS/Android often do
  // not emit another scroll event for a repeated upward-history gesture. That
  // means neither `startReached` nor `atTopStateChange` fires, so the chat can
  // appear hard-stuck at a page boundary even though older rows exist. Listen
  // directly for edge pull intent and route it through the same guarded loader.
  useEffect(() => {
    const el = scrollerElRef.current;
    if (!el) return;

    let lastTouchY: number | null = null;
    let frame: number | null = null;
    const requestEdgeLoad = () => {
      markDeferredPrependUpwardMotion({ explicitGesture: true });
      lastUserUpwardScrollAtRef.current = performance.now();
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (scrollerElRef.current && scrollerElRef.current.scrollTop <= 8) handleStartReached();
      });
    };
    const onTouchStart = (event: TouchEvent) => {
      markDeferredPrependUserInput();
      lastTouchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      markDeferredPrependUserInput();
      const y = event.touches[0]?.clientY ?? null;
      if (y === null || lastTouchY === null) {
        lastTouchY = y;
        return;
      }
      const deltaY = y - lastTouchY;
      lastTouchY = y;
      if (deltaY > 3 && el.scrollTop <= 8) requestEdgeLoad();
    };
    const onWheel = (event: WheelEvent) => {
      markDeferredPrependUserInput();
      if (event.deltaY < -3 && el.scrollTop <= 8) requestEdgeLoad();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [handleStartReached]);

  // Belt-and-braces upward pagination trigger. With top overscan,
  // `startReached` can fail to refire after a successful prepend because the
  // rendered range still spans data index 0 — the user scrolls up but
  // Virtuoso never sees a transition INTO the start. `atTopStateChange`
  // fires on every transition into/out of the top edge, so we use it to
  // re-invoke the same load logic. The `handleStartReached` body is fully
  // idempotent (trust window + cooldown + in-flight guard + `hasOlder`
  // check), so calling it from both paths is safe. We coalesce rapid
  // re-fires via rAF so a fast flick that produces multiple
  // atTop=true→false→true transitions inside a single frame collapses to
  // one call. We also ignore atTop transitions that fire without an
  // accompanying active user gesture — those are caused by the
  // `firstItemIndex` shift after a prepend lands and would otherwise keep
  // queueing new prepends after the user has stopped scrolling.
  const atTopRafRef = useRef<number | null>(null);
  const handleAtTopStateChange = useCallback(
    (atTop: boolean) => {
      if (!atTop) return;
      if (!hasRecentUserUpwardScroll()) return;
      if (atTopRafRef.current !== null) return;
      atTopRafRef.current = requestAnimationFrame(() => {
        atTopRafRef.current = null;
        handleStartReached();
      });
    },
    [handleStartReached, hasRecentUserUpwardScroll],
  );


  const handleScroll = useCallback(() => {
    if (!bottomPinReadyRef.current) return;
    const el = scrollerElRef.current;
    const currentTop = el?.scrollTop ?? 0;
    const previousTop = lastObservedScrollTopRef.current;
    lastObservedScrollTopRef.current = currentTop;
    // Only treat a scroll event as "user scrolled away" when there is a real
    // user gesture behind it. Programmatic `scrollToIndex` snaps (initial
    // pin, stay-pinned re-anchor, follow-output) also dispatch scroll events
    // and would otherwise permanently disable the post-reveal stay-pinned
    // guard — leaving the last message hidden behind the composer after
    // late avatar/image hydration on first cold-cache open.
    const userDrivenScroll = isViewportUserActive(el) || isDeferredPrependUserScrollActive();
    if (!userDrivenScroll) return;
    if (previousTop !== null && currentTop < previousTop - 2) {
      markDeferredPrependUpwardMotion();
      lastUserUpwardScrollAtRef.current = performance.now();
    }
    userHasScrolledAfterPinRef.current = true;
  }, []);

  const handleIsScrollingChange = useCallback((scrolling: boolean) => {
    setDeferredPrependScrolling(scrolling);
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
    if (!initialBottomPinned) return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    let cancelled = false;
    const startedAt = performance.now();
    // Cold post-login opens hydrate more slowly than normal re-opens (auth,
    // profiles, avatars, link previews). Keep the first-open bottom guard
    // alive long enough to absorb that settling without affecting a user who
    // has intentionally scrolled away.
    const STAY_PINNED_MS = 2400;
    let lastScrollHeight = viewport.scrollHeight;
    let lastClientHeight = viewport.clientHeight;

    // SYNCHRONOUS delta compensation. The flicker comes from the gap
    // between a layout-changing paint (image decode / link preview /
    // reaction landing → scrollHeight grows) and the next animation frame
    // where we'd write scrollTop. In that gap the browser paints one frame
    // with content shifted down, then snaps back — visible as a jolt. By
    // adjusting scrollTop synchronously inside the ResizeObserver callback
    // (which fires before the layout-change paint commits) we move the
    // viewport by the exact same delta the inner content grew, so the
    // bottom row stays optically nailed in place.
    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      // Hard guard: if the user is clearly mid-history (>200px from bottom),
      // never re-pin from a ResizeObserver callback. The 600ms cooldown on
      // `isViewportUserActive` can let a settled fast-fling slip through and
      // the synchronous scrollTop write here would race Virtuoso's own
      // paddingTop patch in the same paint frame, producing the classic
      // "jitter then snap" symptom users see on fast scroll-up.
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      // Pure pixel-distance check. atBottomRef is unreliable here because
      // Virtuoso's 120px atBottomThreshold keeps it `true` for the first
      // ~120px of an upward fling — using it as the gate let a fast scroll-up
      // from LAST trigger a synchronous scrollTop=maxTop write inside this
      // RO, visibly snapping the user back to the bottom (DM symptom).
      if (distanceFromBottom > 4) return;
      if (userHasScrolledAfterPinRef.current && distanceFromBottom > 4) return;

      // Coordinate with sibling writers (openPinWindow timers, parent
      // keyboard-pin). If one of them just wrote scrollTop, skip this pass
      // so we don't apply an opposing micro-correction in the same frame.
      if (isRecentChatScrollWrite(200)) return;


      const sh = viewport.scrollHeight;
      const ch = viewport.clientHeight;
      const delta = sh - lastScrollHeight;
      const viewportDelta = ch - lastClientHeight;
      lastScrollHeight = sh;
      lastClientHeight = ch;
      // Bail on sub-pixel / tiny noise so the RO→scroll→RO feedback loop
      // dies quickly. On Android WebView this is the difference between a
      // ~1.5 s main-thread freeze on first open and a clean reveal.
      if (Math.abs(delta) < 2 && Math.abs(viewportDelta) < 2) return;

      // Re-pin to the true max scroll position for BOTH growth and shrink.
      // Cold-login row estimates can correct in either direction; only
      // handling positive deltas leaves the browser to clamp negative deltas
      // on the next paint, which reads as the down/up jolt the user reported.
      const maxTop = sh - viewport.clientHeight;
      const target = Math.max(0, maxTop);
      if (Math.abs(viewport.scrollTop - target) > 0.5) {
        viewport.scrollTop = target;
        markChatScrollWrite();
      }

      if (performance.now() - startedAt > STAY_PINNED_MS) {
        cancelled = true;
        ro.disconnect();
      }
    });
    ro.observe(viewport);
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
  }, [initialRevealReady, bottomPinRevision, initialBottomPinned]);

  // POST-REVEAL JUMP ANCHOR: late row hydration must not move a notification
  // target after the reveal. Retire immediately once the user interacts.
  useEffect(() => {
    if (!initialRevealReady) return;
    const anchor = postJumpAnchorRef.current;
    const viewport = scrollerElRef.current;
    const inner = viewport?.firstElementChild as HTMLElement | null;
    if (!anchor || !viewport || !inner || typeof ResizeObserver === "undefined") return;

    const ANCHOR_WINDOW_MS = 6000;
    const retireAt = anchor.at + ANCHOR_WINDOW_MS;
    const remaining = retireAt - performance.now();
    if (remaining <= 0) return;

    let retired = false;
    let lastSignature = "";
    let mutationObserver: MutationObserver | null = null;
    const resizeObserver = new ResizeObserver(reanchor);
    const retire = () => {
      if (retired) return;
      retired = true;
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(stopTimer);
    };
    function reanchor() {
      if (retired) return;
      if (performance.now() > retireAt || isViewportUserActive(viewport) || userHasScrolledAfterPinRef.current) {
        retire();
        return;
      }
      const signature = `${Math.round(viewport.scrollTop)}:${Math.round(viewport.scrollHeight)}:${Math.round(viewport.clientHeight)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      alignMessageIdInViewRef.current?.(anchor.id, "end");
    }
    resizeObserver.observe(viewport);
    resizeObserver.observe(inner);
    mutationObserver = new MutationObserver(reanchor);
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });
    const stopTimer = window.setTimeout(retire, remaining + 50);
    return retire;
  }, [initialRevealReady, jumpAnchorNonce]);


  // Cold-open data refresh guard. On a fresh login we often render cached
  // messages first, then replace/extend them with the network-fresh latest
  // page. `followOutput` only follows when Virtuoso still reports bottom;
  // first-open measurement drift can make that false, leaving the real latest
  // message below the viewport. During the first few seconds only, keep
  // pinning to LAST while there has been no user scroll gesture.
  useLayoutEffect(() => {
    if (!initialRevealReady || !lastMessageId) return;
    if (!initialBottomPinned) return;
    if (openPinStartedAtRef.current === null) openPinStartedAtRef.current = performance.now();

    const previousLastMessageId = openPinLastMessageIdRef.current;
    openPinLastMessageIdRef.current = lastMessageId;

    const OPEN_PIN_WINDOW_MS = 6000;
    const withinOpenWindow = performance.now() - openPinStartedAtRef.current <= OPEN_PIN_WINDOW_MS;
    if (!withinOpenWindow) return;
    // NOTE: do NOT early-return when lastMessageId is unchanged. On first
    // login the cached page often shares its last message id with the
    // network-fresh page, but the fresh page extends/replaces older rows,
    // which shifts the bottom row's pixel position. We still need to
    // re-pin to LAST in that case — relying on lastMessageId alone misses
    // the jolt entirely. Suppress only when the bottom is already nailed
    // AND messages haven't grown since the last pass.
    const messagesLengthChanged = openPinMessagesLengthRef.current !== messages.length;
    openPinMessagesLengthRef.current = messages.length;
    if (
      previousLastMessageId === lastMessageId &&
      !messagesLengthChanged &&
      bottomPinReadyRef.current
    ) return;
    // PREPEND GUARD: when lastMessageId is unchanged but length grew, an
    // older page just landed (Load More / startReached). This is ALWAYS a
    // prepend — never re-pin to LAST regardless of atBottomRef, because the
    // 120px atBottomThreshold keeps atBottomRef=true for the first ~120px
    // of an upward fling. Without this, a fast scroll-up from the bottom
    // that triggers startReached snaps the viewport back to LAST mid-fling
    // (the reported "I scroll up fast and it pins me back to bottom" bug,
    // especially visible in DMs where new realtime messages keep the
    // OPEN_PIN_WINDOW alive).
    if (
      messagesLengthChanged &&
      previousLastMessageId === lastMessageId
    ) return;

    const run = () => {
      const viewport = scrollerElRef.current;
      if (!viewport) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      // Pure pixel-distance gate (atBottomRef has a 120px threshold and is
      // unreliable mid-fling — see RO guard above).
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distanceFromBottom > 4) return;
      if (userHasScrolledAfterPinRef.current && distanceFromBottom > 4) return;
      if (isRecentChatScrollWrite(80)) return;
      // Silent scrollTop write rather than `scrollToIndex` — the latter
      // triggers a visible Virtuoso recompute/jump every time it fires,
      // which on first-open stacks into a multi-step flicker as cached
      // messages get replaced/extended by the network refresh.
      const maxTop = viewport.scrollHeight - viewport.clientHeight;
      if (Math.abs(viewport.scrollTop - maxTop) > 1) {
        viewport.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };


    // SYNCHRONOUS first pass — commits in the same paint frame as the
    // cached→fresh message swap, so the browser never paints a frame where
    // the bottom row is partially scrolled off. Without this, Android WebView
    // shows a single-frame "jolt" right after first login as the fresh page
    // replaces the cached one. The rAF + delayed passes below remain as a
    // safety net for late-hydrating row heights (avatars, link previews).
    if (!isChatJumpActive()) run();
    const r = requestAnimationFrame(() => requestAnimationFrame(run));
    // Two follow-up passes are enough to absorb the network-fresh page
    // landing on top of cached messages. The previous 5-timer barrage
    // (160/420/900/1600/2600 ms) caused a visible series of jolts on
    // cold opens.
    const timers = [200, 600].map((delay) => window.setTimeout(run, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((timer) => window.clearTimeout(timer));
    };

  }, [initialRevealReady, lastMessageId, messages.length, bottomPinRevision, initialBottomPinned]);

  // OWN-MESSAGE SEND PIN. When the newest appended message belongs to the
  // current user, they just hit Send — the freshly sent bubble MUST be
  // visible regardless of `followOutput`'s atBottom state, the open-pin
  // window, or a stale jump flag. With the keyboard open Virtuoso often
  // reports atBottom=false (the visual viewport shrank under it), so
  // `followOutput` silently skips the append and the sent bubble lands
  // clipped behind the composer. The page-level `onMutate` scrollToBottom
  // can also be swallowed when `isChatJumpActive()` was left set — sending
  // a message is an explicit intent change, so release the jump and pin.
  const prevOwnPinLastIdRef = useRef<string | null>(lastMessageId);
  useLayoutEffect(() => {
    const prevId = prevOwnPinLastIdRef.current;
    prevOwnPinLastIdRef.current = lastMessageId;
    if (!lastMessageId || lastMessageId === prevId) return;
    const last = messages[messages.length - 1] as { author_id?: string | null } | undefined;
    if (!currentUserId || !last || last.author_id !== currentUserId) return;
    if (isChatJumpActive()) setChatJumpActive(false);

    const pin = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      // NOTE: do NOT bail on `isViewportTouching` here. On Android, sending a
      // message keeps the soft keyboard open and the composer/viewport keeps
      // resizing for several hundred ms after send; any of those resize
      // gestures can leave the touch-tracker hot and silently swallow the
      // pin, leaving the freshly-sent bubble clipped behind the composer.
      // Send is an explicit intent change, so always honour it.
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxTop) > 1) {
        el.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };
    safeScrollToIndex({ index: "LAST", align: "end", behavior: "auto" }, "own-message-send-pin");
    pin();
    const r = requestAnimationFrame(() => requestAnimationFrame(pin));
    // Trailing passes absorb composer collapse (reply pill clears, textarea
    // shrinks back to one line), optimistic bubble height settling, and on
    // Android the soft-keyboard / visualViewport reflow that can land 600ms+
    // after send commits.
    const timers = [80, 200, 360, 560, 820, 1200].map((delay) => window.setTimeout(pin, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [lastMessageId, messages, currentUserId, safeScrollToIndex]);


  // Only auto-follow new outgoing messages when the user is already at the
  // bottom — never yank a finger reading history.
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = "auto", options) => {
        // Defer to the next two animation frames. Send mutations call
        // scrollToBottom synchronously inside `onMutate` — BEFORE React has
        // committed the optimistic message into the cache and BEFORE
        // Virtuoso has rendered the new row. Scrolling to "LAST" right
        // then would land on the previous last message and leave the
        // freshly-sent bubble below the viewport. Waiting one paint lets
        // the new item mount; the second rAF guarantees Virtuoso has
        // measured it so `index: "LAST"` resolves to the correct row.
        //
        // We then schedule additional re-pins across the next ~500ms to
        // absorb composer reflow that lands AFTER send commits: the reply
        // pill clears, edit mode exits, the textarea collapses back to a
        // single line, and the optimistic bubble's own height settles
        // (image decode, link preview hydrate). Each of these shrinks or
        // grows the bottomPadding (which mirrors composer height) AFTER
        // the initial scroll, so without follow-up pins the freshly sent
        // bubble ends up clipped behind the fixed composer.
        const run = () => {
          if (messagesLengthRef.current <= 0) return;
          if (isChatJumpActive()) return;
          const viewport = scrollerElRef.current;
          if (options?.force ? isViewportTouching(viewport) : isViewportUserActive(viewport)) return;
          // NOTE: do NOT pass `offset` here. The bottomPadding is already
          // rendered as Virtuoso's Footer inside the list, so it already
          // reserves the composer space above the scroll viewport bottom.
          // Passing offset would apply the composer padding twice and push
          // the last message (and the composer's visual baseline) high up
          // the screen.
          safeScrollToIndex({
            index: "LAST",
            align: "end",
            behavior,
          }, "imperative-scroll-to-bottom");
          requestAnimationFrame(() => {
            const el = scrollerElRef.current;
            if (!el || isChatJumpActive()) return;
            if (options?.force ? isViewportTouching(el) : isViewportUserActive(el)) return;
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            if (Math.abs(el.scrollTop - maxTop) > 1) {
              el.scrollTop = maxTop;
              markChatScrollWrite();
            }
          });
        };
        run();
        requestAnimationFrame(() => requestAnimationFrame(run));
        // Trailing re-pins. Each is independently guarded so an active
        // user gesture (finger drag / momentum) cancels them.
        window.setTimeout(run, 120);
        window.setTimeout(run, 280);
        window.setTimeout(run, 500);
      },

      scrollToIndex: (index, align = "center") => {
        if (messagesLengthRef.current <= 0) return;
        const last = Math.max(0, messagesLengthRef.current - 1);
        const dataIndex = Math.max(0, Math.min(index, last));
        const offset = align === "end" && dataIndex !== last ? getChatBottomPaddingOffset(bottomPadding) : 0;
        // `scrollToIndex` expects the zero-based DATA index even when
        // `firstItemIndex` is used for reverse/prepend anchoring. Passing the
        // shifted absolute index gets clamped by Virtuoso to LAST, which is why
        // notification jumps highlighted the right row but kept the viewport at
        // the bottom of the committee chat.
        safeScrollToIndex({
          index: dataIndex,
          align,
          offset,
          behavior: "auto",
        }, "imperative-scroll-to-index");
      },
      scrollToMessageId: (messageId, align = "center") => alignMessageIdInView(messageId, align),
      isAtBottom: () => atBottomRef.current,
      isNearBottom: (thresholdPx: number) => {
        const el = scrollerElRef.current;
        if (!el) return true;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= Math.max(0, thresholdPx);
      },
    }),
    [bottomPadding, safeScrollToIndex, alignMessageIdInView],
  );

  // O(1) id → index map AND defensive de-duplication. Pagination races (two
  // `startReached` events firing before React flushes `isLoadingOlder=true`)
  // can land the same older page twice, producing duplicate IDs in the array.
  // Virtuoso would then render a "ghost" duplicate row whose key collides
  // with a sibling. Filter out any second occurrence here so the list the
  // virtualiser sees is always strictly unique.
  const { uniqueMessages, indexById } = usePreparedChatMessageWindow(messages);

  // CRITICAL flicker fix: keep `itemContent` identity stable across messages
  // mutations. If this callback's identity changes when an older page lands,
  // Virtuoso re-invokes it for every visible row, defeating React.memo on
  // ChatMessage and producing a full-row repaint flash mid-scroll. We capture
  // the per-render data into refs and reference them inside a callback that
  // is created ONCE per component instance.
  const renderItemRef = useRef<ChatRowRender>((message, index, rows) =>
    renderItem(message as TMessage, index, rows as TMessage[]));
  const uniqueMessagesRef = useRef<ChatRowAdapterMessage[]>(uniqueMessages);
  const indexByIdRef = useRef(indexById);
  const currentUserIdRef = useRef(currentUserId);
  useLayoutEffect(() => {
    renderItemRef.current = (message, index, rows) =>
      renderItem(message as TMessage, index, rows as TMessage[]);
    uniqueMessagesRef.current = uniqueMessages;
    indexByIdRef.current = indexById;
    currentUserIdRef.current = currentUserId;
  }, [renderItem, uniqueMessages, indexById, currentUserId]);

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexByIdRef.current.get(message.id) ?? -1;
      const rows = uniqueMessagesRef.current;
      const signature = createChatRowSignature(message, idx, rows, currentUserIdRef.current);
      return (
        <ChatVirtuosoRowAdapter
          message={message}
          signature={signature}
          renderItemRef={renderItemRef}
          uniqueMessagesRef={uniqueMessagesRef}
          indexByIdRef={indexByIdRef}
          currentUserIdRef={currentUserIdRef}
        />
      );
    },
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);

  const initialTargetIndex = initialTargetMessageId
    ? uniqueMessages.findIndex((message) => message.id === initialTargetMessageId)
    : -1;


  // Force integer measurements. React-Virtuoso's default itemSize uses
  // getBoundingClientRect(), which can oscillate by sub-pixels on fractional
  // DPR phones during momentum scrolling. Each tiny measurement delta causes
  // Virtuoso to mutate paddingTop, which reads as the remaining upward jitter.
  const itemSize = useCallback((el: HTMLElement, field: "offsetHeight" | "offsetWidth") => {
    return field === "offsetHeight" ? el.offsetHeight : el.offsetWidth;
  }, []);

  const components = useMemo<Components<TMessage, ChatVirtuosoContext>>(
    () => ({
      Scroller: ChatVirtuosoScroller,
      Item: ChatVirtuosoItem,
      Header: ChatVirtuosoHeader,
      Footer: ChatVirtuosoFooter,
    }),
    [],
  );
  const virtuosoContext = useMemo<ChatVirtuosoContext>(
    () => ({ topPadding: topPadding ?? 0, bottomPadding: bottomPadding ?? 0 }),
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
      // Track real user gestures (touch / wheel) on the viewport so the
      // post-pin stay-pinned guard can distinguish a user-driven scroll
      // away from programmatic snaps + content-growth driven `atBottom`
      // flips. Without this, the very first programmatic `scrollToIndex`
      // after reveal fires a `scroll` event that we'd mistakenly count as
      // "user scrolled away".
      installChatScrollIntentTracking(scrollerElRef.current);
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
  // Seed from the module-level flag so push-notification jumps that fire
  // `setChatJumpActive(true)` BEFORE this list mounts still show the
  // overlay (the CustomEvent itself would have been dispatched before our
  // listener was attached and silently lost).
  // Keep the skeleton mounted through its fade so a deep-link landing reads
  // as load → settled rather than exposing row hydration and re-anchoring.
  const { isJumpHydrating, renderJumpOverlay } = useChatJumpHydration(scrollerElRef, {
    targetMessageId: initialTargetMessageId,
    usableBottomInsetPx: getChatBottomPaddingOffset(bottomPadding),
    finalAlign: (targetId) => alignMessageIdInViewRef.current?.(targetId, "end"),
  });



  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
      }}
    >
    {!initialRevealReady ? <ChatJumpHydrationSkeleton /> : null}
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        opacity: initialRevealReady ? 1 : 0,
        transition: initialRevealReady ? "opacity 80ms ease-out" : "none",
      }}
    >
    {uniqueMessages.length > 0 ? (
      <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={uniqueMessages}
      firstItemIndex={firstItemIndex}
      // When a deep-link target message id is supplied but isn't in the current
      // message window yet (typical first paint from a push notification — the
      // parent's jump-window hydration query runs async, or silently fails on
      // RLS/network), fall back to anchoring at the latest message instead of
      // leaving Virtuoso unanchored (which can present as a completely blank
      // viewport on Android WebView). Once the hydration completes, the parent
      // bumps its scrollerKey and we remount with a valid `initialTargetIndex`.
      initialTopMostItemIndex={
        // Guard: Virtuoso crashes with "Cannot read properties of undefined
        // (reading 'index')" if we hand it an initial anchor while `data` is
        // still empty — its internal sizer tries to read items[-1].index.
        // This is exactly the cold-start path for a notification tap on
        // team/club chats, where uniqueMessages is briefly [] before the
        // first query resolves. Skip the prop until we actually have rows.
        uniqueMessages.length === 0
          ? undefined
          : initialTargetIndex >= 0
            ? { index: initialTargetIndex, align: "end", behavior: "auto" }
            : (initialBottomPinned || !!initialTargetMessageId)
              ? { index: "LAST", align: "end", behavior: "auto" }
              : undefined
      }
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
      isScrolling={handleIsScrollingChange}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // ROOT-CAUSE FIX for scroll-up flicker/movement: by default Virtuoso
      // wraps its item ResizeObserver callback in requestAnimationFrame, so a
      // row mounted during upward scroll reports its real height ONE FRAME
      // LATE. For that frame the list is positioned with the wrong (default
      // 160px) height, then snaps — visible as per-row flicker on slow scroll
      // and compounding viewport movement on fast flings (react-virtuoso
      // issue #1049). Skipping the rAF makes measurement synchronous within
      // the same layout pass, eliminating the one-frame misposition window.
      // Note: estimator tuning could never fix this — estimateChatRowHeight
      // only feeds debug telemetry; Virtuoso itself only knows
      // defaultItemHeight until the RO reports.
      skipAnimationFrameInResizeObserver
      // Tuned to the real median chat row height: most rows fall in the
      // 90–180px band (text bubble + author + timestamp ≈ 90, image rows
      // with the reserved 4/3 frame ≈ 300). 160 is the population median
      // and minimises the magnitude of the post-measure correction Virtuoso
      // applies to unmeasured rows during a fast upward fling.
      defaultItemHeight={160}
      scrollSeekConfiguration={false}
      // ROOT-CAUSE FIX (round 13): estimateChatRowHeight / chatRowHeightCache
      // never feed Virtuoso — the library only knows defaultItemHeight (160)
      // for unmounted rows and corrects on first mount. On Android touch
      // scrolling that correction is a scrollTop write mid-fling = the
      // visible flicker (slow scroll) and post-stop jolt (fast fling). No
      // estimator tuning can remove it. The only way to eliminate it is to
      // guarantee rows are mounted + measured BEFORE they can reach the
      // viewport: keep the top overscan larger than one full message page
      // (30 rows ≈ 4800px at the 160px default), so the entire loaded window
      // mounts at reveal and each prepended page mounts in ONE batch at the
      // scroll-idle commit. After that batch, scrolling through those rows
      // performs zero corrections. Hydration no longer trickles in mid-fling
      // because nothing mounts mid-fling.
      increaseViewportBy={{ top: 6000, bottom: 600 }}
      minOverscanItemCount={{ top: 8, bottom: 2 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      context={virtuosoContext}
      components={components}
      />
    ) : null}
    {renderJumpOverlay ? <ChatJumpHydrationSkeleton visible={isJumpHydrating} /> : null}
    </div>
    </div>
  );
}

const VirtuosoChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;

/**
 * Public wrapper that picks between the real Virtuoso-backed list and the
 * basic mapped fallback based on the app-admin kill-switch flag. Splitting
 * the choice at the component boundary (rather than via an early return
 * inside the inner component) keeps the Rules of Hooks intact when the flag
 * flips at runtime via cache invalidation.
 */
function VirtualizedChatMessageListSwitcher<TMessage extends { id: string }>(
  props: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const enabled = useChatVirtualizationEnabled();
  if (!enabled) {
    return <BasicChatMessageList ref={ref} {...props} />;
  }
  return <VirtuosoChatMessageList ref={ref} {...props} />;
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListSwitcher) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
