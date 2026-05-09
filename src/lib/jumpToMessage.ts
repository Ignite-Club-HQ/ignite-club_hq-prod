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
  } = {},
) {
  const {
    highlightDurationMs = 2500,
    maxAttempts = 40, // ~6s at 150ms
    intervalMs = 150,
    tryLoadOlder,
  } = options;

  let attempts = 0;
  let cancelled = false;
  let lastLoadOlderAttempt = -1;

  const tick = () => {
    if (cancelled) return;
    attempts += 1;
    const messages = getMessages();
    const handle = getHandle();
    const idx = messages.findIndex((m) => m.id === messageId);

    if (idx >= 0 && handle) {
      setHighlightedMessageId(messageId);
      handle.scrollToIndex(idx, "center");
      // Two follow-up settles (RAF + 350ms) compensate for image decode /
      // late row measurement so the centred target stays centred.
      requestAnimationFrame(() => {
        if (cancelled) return;
        const h2 = getHandle();
        const idx2 = getMessages().findIndex((m) => m.id === messageId);
        if (h2 && idx2 >= 0) h2.scrollToIndex(idx2, "center");
      });
      setTimeout(() => {
        if (cancelled) return;
        const h3 = getHandle();
        const idx3 = getMessages().findIndex((m) => m.id === messageId);
        if (h3 && idx3 >= 0) h3.scrollToIndex(idx3, "center");
      }, 350);
      setTimeout(() => setHighlightedMessageId(null), highlightDurationMs);
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

    if (attempts < maxAttempts) {
      setTimeout(tick, intervalMs);
    }
  };

  // Defer first attempt so the messages list has a chance to mount.
  setTimeout(tick, 50);

  return () => {
    cancelled = true;
  };
}
