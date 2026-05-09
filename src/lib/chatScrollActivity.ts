/**
 * Tracks when ANY chat scroll viewport last received a real scroll event.
 * Used by chat-row sub-components (LinkPreview, ReplyIndicator) to defer
 * height-changing commits until the user has stopped flicking — so a row
 * above the viewport never grows/shrinks mid-scroll and pushes the row the
 * user is reading downward (or upward) by 30–80px.
 *
 * The instrumented viewports are anything carrying `data-chat-scroll-lock="true"`
 * (the legacy mapped scroller) and `[data-chat-virtualized="true"] *` (Virtuoso).
 * A single document-level capture-phase scroll listener handles both — we don't
 * try to track individual containers, which would race with mount order.
 */

let lastScrollAt = 0;
let installed = false;

const onScroll = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  // Cheap structural test — avoids running for every scroll on the page.
  if (
    target.dataset.chatScrollLock === "true" ||
    target.closest('[data-chat-virtualized="true"]')
  ) {
    lastScrollAt = performance.now();
  }
};

function ensureInstalled() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Capture phase so we observe BEFORE child handlers can stopPropagation.
  // Passive — we never preventDefault on scroll.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

export function getLastChatScrollAt(): number {
  ensureInstalled();
  return lastScrollAt;
}

/**
 * Invokes `cb` once the chat scroll viewports have been idle for `idleMs`.
 * Returns a cancel function. Safe to call from React effects.
 */
export function runWhenChatScrollIdle(cb: () => void, idleMs = 250): () => void {
  ensureInstalled();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    if (cancelled) return;
    const since = performance.now() - lastScrollAt;
    if (since >= idleMs) {
      cb();
      return;
    }
    timer = setTimeout(tick, Math.max(40, idleMs - since));
  };
  tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
