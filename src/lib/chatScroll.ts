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
 * Uses a single immediate snap + one rAF safety pass to catch pending layouts.
 */
export function scrollChatToBottom(container: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport) return;

  const snap = () => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  };

  snap();
  requestAnimationFrame(snap);
}

/**
 * Returns true if the viewport is scrolled near the bottom (within threshold px).
 */
export function isNearBottom(container: HTMLElement | null | undefined, threshold = 150): boolean {
  const metrics = getChatScrollMetrics(container);
  if (!metrics) return true; // default to "at bottom" if can't measure
  return metrics.distanceFromBottom <= threshold;
}
