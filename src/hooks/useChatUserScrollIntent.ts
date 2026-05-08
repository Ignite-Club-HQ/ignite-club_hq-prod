import { RefObject, useEffect, useRef, useCallback } from "react";

/**
 * Tracks whether the user is actively touching/wheeling the chat viewport,
 * and the timestamp of the most recent interaction. Used to gate programmatic
 * snap-to-bottom calls so they never override an in-progress scroll gesture.
 */
export function useChatUserScrollIntent(
  scrollContainerRef: RefObject<HTMLElement | null>,
  cooldownMs = 600,
) {
  const lastInteractionAtRef = useRef(0);
  const isTouchingRef = useRef(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const stamp = () => { lastInteractionAtRef.current = performance.now(); };
    const onTouchStart = () => { isTouchingRef.current = true; stamp(); };
    const onTouchEnd = () => { isTouchingRef.current = false; stamp(); };
    const onWheel = () => stamp();

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [scrollContainerRef]);

  const isUserActive = useCallback(() => {
    if (isTouchingRef.current) return true;
    return performance.now() - lastInteractionAtRef.current < cooldownMs;
  }, [cooldownMs]);

  return { isUserActive };
}
