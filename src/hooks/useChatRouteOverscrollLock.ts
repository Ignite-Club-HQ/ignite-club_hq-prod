import { useEffect, useRef } from "react";

const CHAT_SCROLL_SELECTOR = '[data-chat-scroll-lock="true"]';
const INPUT_SELECTOR = "input, textarea, [contenteditable='true']";
// Overlays portaled to document.body that own their own scroll container and
// must NOT be governed by the chat route's overscroll prevention. Without this
// the global touchmove listener treats the overlay's content as "chat chrome"
// and blocks upward scroll (deltaY > 0) inside it.
const OVERLAY_SCROLL_SELECTOR =
  '[data-gif-picker], [data-radix-popper-content-wrapper], [role="dialog"], [data-state="open"][data-side]';

export function useChatRouteOverscrollLock(enabled: boolean) {
  const touchStartYRef = useRef(0);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root || !enabled) return;

    const html = document.documentElement;
    const body = document.body;

    const previousRootOverflowY = root.style.overflowY;
    const previousRootOverscrollBehaviorY = root.style.overscrollBehaviorY;
    const previousHtmlOverscrollBehaviorY = html.style.overscrollBehaviorY;
    const previousBodyOverscrollBehaviorY = body.style.overscrollBehaviorY;

    root.style.overflowY = "hidden";
    root.style.overscrollBehaviorY = "none";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    const isAndroid = /Android/i.test(navigator.userAgent);
    const scheduledScrollResets = new Set<number>();

    // CRITICAL: Android/iOS browsers may auto-scroll the outer app container
    // when focusing the fixed chat composer, even though chat itself owns the
    // only valid scroll area. That pans AppHeader + ChatHeaderShell off the
    // top while the message list remains visible. Keep the outer viewport at
    // origin; only the inner `[data-chat-scroll-lock]` element may scroll.
    const resetOuterViewport = () => {
      if (root.scrollTop !== 0 || root.scrollLeft !== 0) {
        root.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      if (html.scrollTop !== 0) html.scrollTop = 0;
      if (body.scrollTop !== 0) body.scrollTop = 0;
    };

    // Coalesce reset bursts. Previously every scroll event (including each
    // fling frame on Android) enqueued 4 setTimeouts at 50/150/350/700ms,
    // which all fired after the fling stopped — producing a visible "jolt"
    // and forcing layout reads on top of inertia. Now we run at most one
    // rAF-coalesced reset per burst, and reserve the long-tail passes for
    // explicit triggers (focus, viewport resize, mount).
    let pendingRaf: number | null = null;
    const scheduleOuterViewportReset = () => {
      if (pendingRaf != null) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        resetOuterViewport();
      });
    };
    const scheduleOuterViewportResetWithTail = () => {
      resetOuterViewport();
      requestAnimationFrame(resetOuterViewport);
      [150, 350, 700].forEach((delay) => {
        const id = window.setTimeout(() => {
          scheduledScrollResets.delete(id);
          resetOuterViewport();
        }, delay);
        scheduledScrollResets.add(id);
      });
    };

    scheduleOuterViewportReset();

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isAndroid) return;

      const currentY = event.touches[0]?.clientY;
      if (currentY == null) return;

      const target = event.target as HTMLElement | null;
      if (!target || target.closest(INPUT_SELECTOR)) return;

      const deltaY = currentY - touchStartYRef.current;
      if (deltaY === 0) return;

      // If the touch is happening inside an overlay (e.g. the GIF picker
      // portaled to <body>), let the overlay's own scroll container handle
      // it — don't apply chat-route overscroll prevention here.
      if (target.closest(OVERLAY_SCROLL_SELECTOR)) return;

      const scrollContainer = target.closest(CHAT_SCROLL_SELECTOR) as HTMLElement | null;

      // Prevent Android pull-to-refresh ONLY when dragging down from explicit
      // chat chrome (header/composer marked with data-chat-chrome). Previously
      // this fired for ANY non-scrollable target, which intermittently cancelled
      // legitimate touchmoves inside menus, sheets and image viewers, producing
      // the "scroll froze / skipped a frame" symptom mid-flick.
      if (!scrollContainer) {
        if (deltaY > 0 && target.closest('[data-chat-chrome="true"]')) {
          event.preventDefault();
        }
        return;
      }

      const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const atTop = scrollContainer.scrollTop <= 0;
      const atBottom = scrollContainer.scrollTop >= maxScrollTop - 1;

      if ((deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
        event.preventDefault();
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("focusin", scheduleOuterViewportReset, true);
    window.addEventListener("resize", scheduleOuterViewportReset);
    window.addEventListener("scroll", scheduleOuterViewportReset, { passive: true });
    root.addEventListener("scroll", scheduleOuterViewportReset, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleOuterViewportReset);
    window.visualViewport?.addEventListener("scroll", scheduleOuterViewportReset);

    return () => {
      scheduledScrollResets.forEach((id) => window.clearTimeout(id));
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("focusin", scheduleOuterViewportReset, true);
      window.removeEventListener("resize", scheduleOuterViewportReset);
      window.removeEventListener("scroll", scheduleOuterViewportReset);
      root.removeEventListener("scroll", scheduleOuterViewportReset);
      window.visualViewport?.removeEventListener("resize", scheduleOuterViewportReset);
      window.visualViewport?.removeEventListener("scroll", scheduleOuterViewportReset);

      root.style.overflowY = previousRootOverflowY;
      root.style.overscrollBehaviorY = previousRootOverscrollBehaviorY;
      html.style.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      body.style.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, [enabled]);
}
