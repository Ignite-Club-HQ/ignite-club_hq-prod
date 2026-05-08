export function resolveChatScrollViewport(container: HTMLElement | null | undefined) {
  if (!container) return null;

  if (container.matches?.("[data-radix-scroll-area-viewport]")) {
    return container;
  }

  return container.querySelector?.<HTMLElement>("[data-radix-scroll-area-viewport]") ?? container;
}

export function getChatScrollMetrics(container: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport) return null;

  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

  return {
    viewport,
    maxScrollTop,
    distanceFromBottom: Math.max(0, maxScrollTop - viewport.scrollTop),
  };
}

/**
 * Scrolls a chat container to the absolute bottom.
 * Uses an immediate snap + double-rAF + a 150ms delayed pass to catch
 * async layout changes (e.g. ResizeObserver updating composer height).
 */
export function scrollChatToBottom(container: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport) return;

  const snap = () => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  };

  snap();
  requestAnimationFrame(() => {
    snap();
    requestAnimationFrame(snap);
  });

  // Catch async ResizeObserver → state update → re-render → layout cycle.
  // CRITICAL: bail if the user has since scrolled meaningfully away from the
  // bottom. Without this guard, this delayed snap fires mid-flick (the user
  // started scrolling up between the initial snap and now) and yanks them
  // back to bottom — the "I scroll up and it jumps back down" jolt.
  setTimeout(() => {
    const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    if (distance > 80) return;
    snap();
  }, 150);
}

const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export function scrollChatElementIntoView(container: HTMLElement | null | undefined, element: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport || !element) return;

  const viewportRect = viewport.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const targetTop = viewport.scrollTop + elementRect.top - viewportRect.top - Math.max(24, (viewport.clientHeight - elementRect.height) / 2);
  // Android Chrome WebView: smooth scroll programmatic calls hijack any
  // in-progress touch/inertia scroll. Use auto on Android (per project memory)
  // and smooth elsewhere.
  viewport.scrollTo({ top: Math.max(0, targetTop), behavior: isAndroid ? "auto" : "smooth" });
}

/**
 * Returns true if the viewport is scrolled near the bottom (within threshold px).
 */
export function isNearBottom(container: HTMLElement | null | undefined, threshold = 150): boolean {
  const metrics = getChatScrollMetrics(container);
  if (!metrics) return true; // default to "at bottom" if can't measure
  return metrics.distanceFromBottom <= threshold;
}
