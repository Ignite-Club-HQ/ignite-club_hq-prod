import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";

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
  let hydrationEnded = false;
  const endHydration = () => {
    if (hydrationEnded) return;
    hydrationEnded = true;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("chat:jump-hydration-end"));
    }
  };

  let attempts = 0;
  let cancelled = false;
  let lastLoadOlderAttempt = -1;
  let highlightClearTimer: ReturnType<typeof setTimeout> | null = null;
  let nextTickTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let landedOnParent = false;

  const focusOn = (id: string, idx: number, handle: VirtualizedChatMessageListHandle) => {
    setHighlightedMessageId(id);
    handle.scrollToIndex(idx, "center");
    // Single deferred re-centre AFTER row mounts and any deferred sub-content
    // (replies / link previews / reactions) has had a chance to commit. Doing
    // multiple back-to-back scrollToIndex("center") calls (immediate + rAF +
    // 350ms) is what produced the visible jitter on push-notification deep
    // links: each call re-anchors to a different measured row height as
    // sub-content hydrates. One settle pass is enough — the ResizeObserver
    // height-compensator in chatScrollActivity handles late growth.
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (cancelled) return;
      const h3 = getHandle();
      const idx3 = getMessages().findIndex((m) => m.id === id);
      if (h3 && idx3 >= 0) h3.scrollToIndex(idx3, "center");
      // Sub-content has had a chance to hydrate by now; lift the skeleton.
      endHydration();
    }, 450);
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
    }
  };

  // Defer first attempt so the messages list has a chance to mount.
  nextTickTimer = setTimeout(tick, 50);

  const cancel = () => {
    cancelled = true;
    if (nextTickTimer) clearTimeout(nextTickTimer);
    if (settleTimer) clearTimeout(settleTimer);
    if (highlightClearTimer) clearTimeout(highlightClearTimer);
    if (activeCancel === cancel) activeCancel = null;
  };
  activeCancel = cancel;
  return cancel;
}
