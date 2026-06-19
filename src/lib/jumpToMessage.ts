import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { setChatJumpActive } from "@/lib/chatJumpActive";
import { getJumpSettleConfig } from "@/lib/jumpSettleConfig";



/**
 * Virtuoso-driven jump-to-message used by every chat surface (Team / Group /
 * Club / Broadcast / ClubAdmin / DM) for deep-link targets, search-result
 * selection, pinned-message taps, and reply-quote taps.
 *
 * Polls the caller-provided `messages` array until the target id appears,
 * then drives the virtualised list via its imperative handle (`scrollToIndex`).
 * If the message isn't in the loaded set, calls `tryLoadOlder` to page
 * backwards and retries.
 *
 * No `document.getElementById('message-${id}')` lookup is used anywhere:
 * rows outside Virtuoso's render window are not in the DOM.
 */
let activeCancel: (() => void) | null = null;

export function jumpToMessageInVirtualizedChat<TMessage extends { id: string }>(
  messageId: string,
  getMessages: () => TMessage[],
  getHandle: () => VirtualizedChatMessageListHandle | null,
  setHighlightedMessageId: (id: string | null) => void,
  options: {
    highlightDurationMs?: number;
    maxAttempts?: number;
    intervalMs?: number;
    tryLoadOlder?: () => void;
    /**
     * Cold-start push-notification race fix: when the target is the NEWEST
     * message, the initial fetch may hit a read-replica that hasn't yet
     * replicated the just-inserted row. `tryLoadOlder` cannot help (the row
     * isn't older — it's missing entirely). This callback re-runs the head
     * query (e.g. `queryClient.invalidateQueries(["team-messages", id])`)
     * on escalating retries (attempts 4, 16, 40) so the lagging replica
     * gets re-polled until the row appears. Optional; safe to omit.
     */
    refetchLatest?: () => void;
    /**
     * Optional thread/parent context. When the primary `messageId` cannot be
     * located in the loaded set after exhausting older-page loads, the helper
     * falls back to scrolling to (and briefly highlighting) the parent so the
     * user lands in the correct conversational context. Once the original
     * target finally appears, focus is re-centred onto it and highlight moves.
     */
    parentMessageId?: string;
  } = {},
) {
  const {
    highlightDurationMs = 2500,
    // ~30s at 150ms — must outlast cold-start auth + chat-page mount + first
    // message fetch + realtime subscription handshake when the user arrives via
    // a push-notification deep link (especially on Android where app warmup is
    // slower). Previously 6s, which timed out before the target row arrived.
    maxAttempts = 200,
    intervalMs = 150,
    tryLoadOlder,
    refetchLatest,
    parentMessageId,
  } = options;

  console.log("[jumpToMessage] starting", {
    targetMessageId: messageId,
    parentMessageId,
    loadedCount: getMessages().length,
  });

  // Auto-cancel any in-flight jump so rapid search-result navigation
  // (next/next/next) doesn't stack polling loops, fight over scrollToIndex,
  // or let a stale 2.5s highlight-clear wipe the newest target.
  if (activeCancel) activeCancel();

  // Notify the virtualised chat list to render a brief skeleton overlay
  // while we poll + scroll + settle. This masks the visible re-anchor that
  // happens as deferred row sub-content (link previews, replies, reactions)
  // hydrates AFTER the initial scrollToIndex lands. The list listens for
  // these CustomEvents and fades the overlay out once "end" fires.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("chat:jump-hydration-start"));
  }
  setChatJumpActive(true);
  let hydrationEnded = false;
  const endHydration = () => {
    if (hydrationEnded) return;
    hydrationEnded = true;
    setChatJumpActive(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("chat:jump-hydration-end"));
    }
  };


  let attempts = 0;
  let cancelled = false;
  let lastLoadOlderAttempt = -1;
  let lastRefetchLatestAttempt = -1;
  let highlightClearTimer: ReturnType<typeof setTimeout> | null = null;
  let nextTickTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimers: ReturnType<typeof setTimeout>[] = [];
  let landedOnParent = false;
  // ResizeObserver on the focused row: late hydration (reactions pill,
  // read-frontier strip, image decode, mention/link previews) can grow the
  // row AFTER the final settle pass / tail release. Without a re-pin, the
  // newly grown bottom slides underneath the fixed composer — the
  // "bottom obscured" symptom on long target messages from notification
  // taps. We observe the row for ~6s and re-apply the exact-DOM "end"
  // correction whenever its height changes.
  let rowObserver: ResizeObserver | null = null;
  let rowObserverTimer: ReturnType<typeof setTimeout> | null = null;
  const tearDownRowObserver = () => {
    if (rowObserver) { rowObserver.disconnect(); rowObserver = null; }
    if (rowObserverTimer) { clearTimeout(rowObserverTimer); rowObserverTimer = null; }
  };

  const clearSettleTimers = () => {
    settleTimers.forEach((timer) => clearTimeout(timer));
    settleTimers = [];
  };

  // Counter used to defeat Virtuoso's scrollToIndex deduplication. On repeat
  // notification taps, vary the ALIGNMENT but keep the INDEX fixed on the
  // target row. Never prime-scroll to idx-1: if the final end-align call is
  // deduped/dropped, that leaves the viewport on an earlier message.
  let passCounter = 0;

  const focusOn = (id: string, idx: number, handle: VirtualizedChatMessageListHandle) => {
    setHighlightedMessageId(id);
    // Notification/search/reply jumps should land the target at the bottom of
    // the visible chat viewport, just above the fixed composer. Virtuoso's
    // `end` alignment accounts for the list Footer, whose height mirrors the
    // composer + safe-area padding. Using `center` for older targets was the
    // source of the observed behaviour: the correct row highlighted, but it
    // was not consistently visible in the expected bottom slot.
    const align: "end" = "end";
    clearSettleTimers();
    const messagesAtFocus = getMessages();
    const lastIdx = messagesAtFocus.length - 1;
    // Specific failure mode from Grounds/Dan notification repeat taps:
    // after the first successful jump, the local cache may contain weeks of
    // older rows before a recent target (`f368…` was index 63/65, while the
    // bad landing was index 35/65). A direct scrollToIndex for the recent row
    // then asks Virtuoso to estimate across many unmeasured, variable-height
    // rows; the computed scrollTop can visibly land on an older 28 May row.
    // Pre-warm the latest render window first when the target is already near
    // the end of a long chat, then scroll to the target after Virtuoso has had
    // a frame to mount/measure the recent rows.
    const shouldPrewarmLatestWindow = messagesAtFocus.length > 30 && idx >= Math.max(0, lastIdx - 4) && idx < lastIdx;
    const scrollTarget = () => {
      const h = getHandle();
      const currentMessages = getMessages();
      const currentIdx = currentMessages.findIndex((m) => m.id === id);
      if (!h || currentIdx < 0) return;
      // If the row is already mounted (especially after the latest-window
      // prewarm), use exact DOM geometry FIRST. Calling Virtuoso's estimated
      // `scrollToIndex` first can jump to an older unmeasured window and
      // unmount the target before the DOM correction gets a chance to run —
      // the repeat-tap failure seen on Dan's Grounds notification.
      if (h.scrollToMessageId?.(id, align)) return;
      h.scrollToIndex(currentIdx, "center");
      h.scrollToIndex(currentIdx, align);
      requestAnimationFrame(() => h.scrollToMessageId?.(id, align));
    };

    if (shouldPrewarmLatestWindow) {
      handle.scrollToIndex(lastIdx, align);
      settleTimers.push(setTimeout(scrollTarget, 90));
    } else {
      // Priming nudge: use the target row itself with a different alignment so
      // even if the second call is ignored, the user still lands on the correct
      // message rather than an older neighbour.
      scrollTarget();
    }
    passCounter += 1;
    // Multi-pass settle: row heights shift as deferred sub-content (link
    // previews, reply quotes, reactions, images) hydrates AFTER the initial
    // scrollToIndex. Re-centre across a ~1.8s window with `isChatJumpActive`
    // still true so the open-pin / stay-pinned compensators can't snap the
    // viewport to bottom in between passes.
    //
    // Then HOLD `isChatJumpActive` true for a long tail (~6.5s from jump
    // start) before releasing. The virtualised list's open-pin window runs
    // for 6s from chat mount, and its stay-pinned ResizeObserver runs for
    // 2.4s from reveal; both schedule deferred timers that fire AFTER the
    // initial settle window. Without the tail hold, those timers run with
    // jump-active=false and yank the viewport back to the latest message —
    // exactly the symptom reported when tapping a push-notification deep
    // link: the target row is highlighted, but the viewport sits at bottom.
    // Batch 3D: pull settle passes + tail-release in from 6.5s → 2.2s.
    // Safe because Batch 3C defers link-preview fetches during the jump
    // window, so deferred row growth no longer drives re-corrections after
    // ~1.5s. Kill-switch: localStorage['ignite_disable_short_jump_settle']='1'.
    const { settlePasses, tailReleaseMs: TAIL_RELEASE_MS } = getJumpSettleConfig();
    const recenter = () => {
      if (cancelled) return;
      const h3 = getHandle();
      const messages3 = getMessages();
      const idx3 = messages3.findIndex((m) => m.id === id);
      if (h3 && idx3 >= 0) {
        if (h3.scrollToMessageId?.(id, align)) return;
        // Alternate a 1px upward nudge on every other pass so two
        // consecutive recenters never present identical payloads to
        // Virtuoso (which would dedupe the second one to a no-op).
        passCounter += 1;
        if (passCounter % 2 === 0) h3.scrollToIndex(idx3, "center");
        h3.scrollToIndex(idx3, align);
        requestAnimationFrame(() => h3.scrollToMessageId?.(id, align));
      }
    };
    settlePasses.forEach((delay) => {
      settleTimers.push(setTimeout(recenter, delay));
    });
    // Tail: one final recenter, then release the jump-active flag so the
    // chat returns to normal auto-pin behaviour for subsequent new messages.
    settleTimers.push(setTimeout(() => {
      recenter();
      endHydration();
    }, TAIL_RELEASE_MS));
    if (highlightClearTimer) clearTimeout(highlightClearTimer);
    highlightClearTimer = setTimeout(() => {
      if (cancelled) return;
      setHighlightedMessageId(null);
    }, highlightDurationMs);
  };



  const tick = () => {
    if (cancelled) return;
    attempts += 1;
    const messages = getMessages();
    const handle = getHandle();
    const idx = messages.findIndex((m) => m.id === messageId);

    // Defer settle passes until the real fetch has hydrated at least a
    // small window of history. Otherwise (push-notification preload cache
    // with a single row) scrollToIndex(0,"end") lands the lone message at
    // the top of an empty viewport and the settle window suppresses the
    // bottom-pin compensator that would normally fix it.
    if (idx >= 0 && handle && messages.length > 1) {
      focusOn(messageId, idx, handle);
      // If we previously landed on the parent as a fallback, keep polling so
      // we can re-centre once the real target row finishes mounting; but
      // since we've now found it, we're done.
      return;
    }

    // Not in loaded set yet — page older if we have a loader. Trigger sooner
    // (attempt 3 ≈ 450 ms instead of 7 ≈ 1050 ms) so notification-jumps reach
    // older messages faster, but still throttle to ~600 ms between fetches.
    if (
      idx < 0 &&
      tryLoadOlder &&
      attempts > 2 &&
      attempts - lastLoadOlderAttempt >= 4
    ) {
      lastLoadOlderAttempt = attempts;
      tryLoadOlder();
    }

    // Cold-start push-notification race: when the target is the NEWEST message,
    // tryLoadOlder won't surface it (it's not older — the initial fetch hit a
    // lagging read-replica that hadn't replicated the just-inserted row yet).
    // Re-invalidate the head query on escalating retries so the replica gets
    // re-polled until the row appears. Attempts 4, 16, 40 ≈ 0.6s / 2.4s / 6s.
    if (idx < 0 && refetchLatest && attempts - lastRefetchLatestAttempt >= 12 && (attempts === 4 || attempts >= 16)) {
      lastRefetchLatestAttempt = attempts;
      refetchLatest();
    }


    // Parent fallback: if the target is still missing past the half-way mark
    // but the parent is loaded, land on the parent so the user has context
    // while we keep polling for the real target.
    if (
      !landedOnParent &&
      parentMessageId &&
      attempts >= Math.floor(maxAttempts / 2) &&
      handle
    ) {
      const parentIdx = messages.findIndex((m) => m.id === parentMessageId);
      if (parentIdx >= 0) {
        landedOnParent = true;
        focusOn(parentMessageId, parentIdx, handle);
      }
    }

    if (attempts < maxAttempts) {
      nextTickTimer = setTimeout(tick, intervalMs);
    } else {
      // Polling exhausted without landing — drop the skeleton so the user
      // isn't stuck staring at it. Per spec: NEVER route to an earlier
      // message from the same sender; log a warning and leave the chat at
      // its current position (newest) so the user can scroll to context.
      console.warn("[jumpToMessage] target not found after polling", {
        targetMessageId: messageId,
        attempts,
        loadedCount: getMessages().length,
        landedOnParent,
      });
      endHydration();
    }
  };

  // Defer first attempt so the messages list has a chance to mount.
  nextTickTimer = setTimeout(tick, 50);

  const cancel = () => {
    cancelled = true;
    if (nextTickTimer) clearTimeout(nextTickTimer);
    clearSettleTimers();
    if (highlightClearTimer) clearTimeout(highlightClearTimer);
    endHydration();
    if (activeCancel === cancel) activeCancel = null;
  };
  activeCancel = cancel;
  return cancel;
}
