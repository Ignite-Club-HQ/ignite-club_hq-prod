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

const isChatEventTarget = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('[data-chat-scroll-lock="true"], [data-chat-virtualized="true"]');
};

const markChatActivity = (event: Event) => {
  const target = event.target;
  // Cheap structural test — avoids running for every scroll/gesture on the page.
  if (isChatEventTarget(target)) {
    lastScrollAt = performance.now();
  }
};

function ensureInstalled() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Capture phase so we observe BEFORE child handlers can stopPropagation.
  // Include pre-scroll gestures: on a fast first flick, the browser may not
  // dispatch `scroll` until after React commits a link/reply hydration update.
  // Marking touch/wheel/pointer activity closes that race.
  const opts = { capture: true, passive: true } as const;
  document.addEventListener("scroll", markChatActivity, opts);
  document.addEventListener("touchstart", markChatActivity, opts);
  document.addEventListener("touchmove", markChatActivity, opts);
  document.addEventListener("wheel", markChatActivity, opts);
  document.addEventListener("pointerdown", markChatActivity, opts);
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

function findChatViewport(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  return element.closest<HTMLElement>('[data-chat-scroll-lock="true"]');
}

function isVirtualizedChatViewport(viewport: HTMLElement): boolean {
  return !!viewport.closest('[data-chat-virtualized="true"]');
}

/**
 * Observes a height-changing chat sub-tree and absorbs its resize when it is
 * above the visible viewport. This prevents the classic post-scroll jolt where
 * deferred link previews, replies, reactions, or async cards grow after
 * momentum ends and push the message the user stopped on downward.
 */
export function observeChatElementHeight(element: HTMLElement | null): () => void {
  ensureInstalled();
  if (!element || typeof ResizeObserver === "undefined") return () => {};

  let lastHeight = element.getBoundingClientRect().height;
  let adjusting = false;

  const observer = new ResizeObserver((entries) => {
    if (adjusting) return;
    const entry = entries[0];
    if (!entry) return;

    const nextHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    const delta = nextHeight - lastHeight;
    lastHeight = nextHeight;
    if (Math.abs(delta) < 0.75) return;

    const viewport = findChatViewport(element);
    if (!viewport) return;

    // In virtualized chat, react-virtuoso is the sole owner of row measurement
    // and scroll anchoring. Writing scrollTop from a per-row ResizeObserver is
    // exactly what creates the Android "scroll stops, then messages move down"
    // jolt: the correction lands just after native momentum settles, fighting
    // Virtuoso's own padding/anchor reconciliation. Keep this legacy absorber
    // only for non-virtual chat containers.
    if (isVirtualizedChatViewport(viewport)) return;

    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();

    // Compensate growth/shrink above the user's visual anchor, not only fully
    // off-screen rows. On virtualized chat this is especially important after
    // a native momentum fling stops: deferred reply/link/gallery/read updates
    // often commit during the idle window, and Virtuoso may re-measure the row
    // after paint. Correcting scrollTop in the ResizeObserver turn preserves
    // the message the user stopped on instead of letting it visibly jump.
    // Keep lower-half changes natural so the row the user is actively reading
    // doesn't get fought by scrollTop corrections.
    const anchorLine = viewportRect.top + viewportRect.height * 0.38;
    if (elementRect.top >= anchorLine) return;

    const previousBehavior = viewport.style.scrollBehavior;
    adjusting = true;
    viewport.style.scrollBehavior = "auto";
    viewport.scrollTop += delta;
    requestAnimationFrame(() => {
      viewport.style.scrollBehavior = previousBehavior;
      adjusting = false;
    });
  });

  observer.observe(element);
  return () => observer.disconnect();
}
