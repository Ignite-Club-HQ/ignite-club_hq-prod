import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { setChatJumpActive } from "@/lib/chatJumpActive";



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
  let highlightClearTimer: ReturnType<typeof setTimeout> | null = null;
  let nextTickTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimers: ReturnType<typeof setTimeout>[] = [];
  let landedOnParent = false;

  const clearSettleTimers = () => {
    settleTimers.forEach((timer) => clearTimeout(timer));
    settleTimers = [];
  };

  // Counter used to defeat Virtuoso's scrollToIndex deduplication. When the
  // target row is already in (or near) the rendered window — which is the
  // common case for the SECOND tap of the same notification — Virtuoso will
  // treat an identical scrollToIndex payload as a no-op and the viewport
  // never re-anchors, leaving the highlighted row "higher up" than expected.
  // By varying the payload (via the index passed to the handle, which the
  // handle then clamps), each pass is treated as a distinct request.
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
    // Priming nudge: if the row is already in the rendered window from a
    // previous jump, jiggle the scroll position by one index first so the
    // subsequent end-aligned call is recognised as a fresh request rather
    // than a duplicate of the prior one. The nudge target is clamped by the
    // handle, so passing idx+1 is safe even at the tail of the list.
    handle.scrollToIndex(Math.max(0, idx - 1), "start");
    handle.scrollToIndex(idx, align);
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
    clearSettleTimers();
    const settlePasses: number[] = [250, 600, 1100, 1800, 3000, 4500];
    const TAIL_RELEASE_MS = 6500;
    const recenter = () => {
      if (cancelled) return;
      const h3 = getHandle();
      const messages3 = getMessages();
      const idx3 = messages3.findIndex((m) => m.id === id);
      if (h3 && idx3 >= 0) {
        // Alternate a 1px upward nudge on every other pass so two
        // consecutive recenters never present identical payloads to
        // Virtuoso (which would dedupe the second one to a no-op).
        passCounter += 1;
        if (passCounter % 2 === 0) {
          h3.scrollToIndex(Math.max(0, idx3 - 1), "start");
        }
        h3.scrollToIndex(idx3, align);
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

    if (idx >= 0 && handle) {
      focusOn(messageId, idx, handle);
      // If we previously landed on the parent as a fallback, keep polling so
      // we can re-centre once the real target row finishes mounting; but
      // since we've now found it, we're done.
      return;
    }

    // Not in loaded set yet — page older if we have a loader and we've waited
    // a bit. Throttle to one tryLoadOlder per ~8 ticks (~1.2s) so we don't
    // hammer the backend.
    if (
      idx < 0 &&
      tryLoadOlder &&
      attempts > 6 &&
      attempts - lastLoadOlderAttempt >= 8
    ) {
      lastLoadOlderAttempt = attempts;
      tryLoadOlder();
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
