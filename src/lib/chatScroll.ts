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

  metrics.viewport.scrollTop = metrics.viewport.scrollHeight + 8;
}