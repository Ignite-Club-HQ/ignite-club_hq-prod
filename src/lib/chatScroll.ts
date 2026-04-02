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

export function scrollChatToBottom(container: HTMLElement | null | undefined) {
  const metrics = getChatScrollMetrics(container);
  if (!metrics) return;

  const { viewport } = metrics;

  const snapToBottom = () => {
    const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (max > 0) {
      viewport.scrollTop = max;
    }
  };

  snapToBottom();

  if (typeof window !== "undefined") {
    // Double-rAF catches layout shifts from React re-renders
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        snapToBottom();
      });
    });

    // Delayed pass catches deferred React updates / lazy-loaded content
    setTimeout(snapToBottom, 80);
  }
}