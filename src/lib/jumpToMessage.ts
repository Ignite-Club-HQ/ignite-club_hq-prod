import { resolveChatScrollViewport } from "@/lib/chatScroll";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";

const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Scroll a chat scroll-area to a specific message DOM node (`message-${id}`).
 * Uses viewport-scoped scrollTop math (NOT scrollIntoView) so it never yanks
 * the outer document scroll on Android per the chat viewport rules.
 */
function scrollViewportToElement(
  viewport: HTMLElement,
  el: HTMLElement,
  block: "center" | "start" = "center",
) {
  const viewportRect = viewport.getBoundingClientRect();
  const elementRect = el.getBoundingClientRect();
  const offset =
    block === "center"
      ? Math.max(24, (viewport.clientHeight - elementRect.height) / 2)
      : 24;
  const targetTop =
    viewport.scrollTop + elementRect.top - viewportRect.top - offset;
  viewport.scrollTo({
    top: Math.max(0, targetTop),
    behavior: isAndroid ? "auto" : "smooth",
  });
}

/**
 * Scroll to a specific message in a chat thread by its DOM id (`message-${id}`).
 * Highlights it briefly via the provided setter to match the existing
 * targetMessageId / search-result UX pattern.
 */
export function jumpToMessageInChat(
  messageId: string,
  setHighlightedMessageId: (id: string | null) => void,
  highlightDurationMs = 2000,
  scrollContainer?: HTMLElement | null,
) {
  setHighlightedMessageId(messageId);
  requestAnimationFrame(() => {
    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    const viewport = resolveChatScrollViewport(scrollContainer);
    if (viewport) {
      scrollViewportToElement(viewport, el, "center");
    } else {
      el.scrollIntoView({ behavior: isAndroid ? "auto" : "smooth", block: "center" });
    }
  });
  setTimeout(() => setHighlightedMessageId(null), highlightDurationMs);
}

/**
 * Robustly scroll to a notification/deep-link target message after the chat
 * mounts. Retries across the keyboard/layout settle window so the target lands
 * centered even if the message DOM renders after several async passes
 * (auth → query → render → ResizeObserver). If the message isn't in the
 * loaded set, calls `tryLoadOlder` to page backwards and retries.
 *
 * Returns a cancel fn for cleanup.
 */
export function scrollToTargetMessageWhenReady(
  messageId: string,
  scrollContainer: HTMLElement | null | undefined,
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
    const viewport = resolveChatScrollViewport(scrollContainer);
    const el = document.getElementById(`message-${messageId}`);

    if (el && viewport) {
      setHighlightedMessageId(messageId);
      // Two passes: snap, then re-correct after layout settles (image
      // dimensions, lazy avatars) so the centered target stays centered.
      scrollViewportToElement(viewport, el, "center");
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el2 = document.getElementById(`message-${messageId}`);
        if (el2) scrollViewportToElement(viewport, el2, "center");
      });
      setTimeout(() => {
        if (cancelled) return;
        const el3 = document.getElementById(`message-${messageId}`);
        if (el3 && viewport) scrollViewportToElement(viewport, el3, "center");
      }, 350);
      setTimeout(() => setHighlightedMessageId(null), highlightDurationMs);
      return;
    }

    // Not in DOM yet — page older if we have a loader and we've waited a bit.
    if (
      !el &&
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

/**
 * Virtuoso-aware variant of `scrollToTargetMessageWhenReady`. Polls the
 * caller-provided `messages` array until the target id appears, then drives
 * the virtualised list via its imperative handle. If the message isn't in
 * the loaded set, calls `tryLoadOlder` to page backwards and retries.
 *
 * Designed for chat pages migrated to `VirtualizedChatMessageList` where the
 * legacy `document.getElementById('message-${id}')` lookup no longer works
 * (rows outside Virtuoso's render window are not in the DOM).
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
    maxAttempts = 40,
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

  setTimeout(tick, 50);

  return () => {
    cancelled = true;
  };
}
