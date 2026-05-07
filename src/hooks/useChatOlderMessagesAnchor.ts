import { RefObject, useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/**
 * Smooth "load older messages" anchoring for chat scrollers.
 *
 * Eliminates the visual jolt when prepending older messages by:
 *  1. Capturing scroll metrics BEFORE the cache mutation.
 *  2. Running the cache mutation inside `flushSync` so React commits the
 *     taller list synchronously — then immediately correcting `scrollTop`
 *     in the SAME task. The browser never paints the intermediate state,
 *     so the user sees no jump.
 *  3. Re-applying the correction once newly-prepended images decode
 *     (their final height may differ from the initial reservation).
 *  4. Briefly disabling smooth-scroll on the container during the restore
 *     so any inherited `scroll-behavior: smooth` doesn't animate the fix.
 *
 * Also provides an IntersectionObserver wrapper that ignores hits while
 * the user is mid-flick (debounced by recent scrollTop change), preventing
 * the "trigger fires while finger is still moving" stutter.
 */

interface UseChatOlderMessagesAnchorOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  loadTriggerRef: RefObject<HTMLElement | null>;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  enabled?: boolean;
  /** Called when the observer decides it's time to fetch older messages. */
  onTrigger: () => void;
}

const IDLE_GATE_MS = 120;
const POST_RESTORE_IMAGE_WATCH_MS = 1500;

export function useChatOlderMessagesAnchor({
  scrollContainerRef,
  loadTriggerRef,
  hasOlderMessages,
  isLoadingOlder,
  enabled = true,
  onTrigger,
}: UseChatOlderMessagesAnchorOptions) {
  const lastScrollAtRef = useRef(0);

  // Track "recently scrolled" so we don't trigger fetches mid-flick.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      lastScrollAtRef.current = performance.now();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef]);

  // IntersectionObserver — pre-fetch BEFORE user reaches the top, but
  // refuse to fire while the user is actively scrolling.
  useEffect(() => {
    const scrollRoot = scrollContainerRef.current;
    const trigger = loadTriggerRef.current;
    if (!enabled || !scrollRoot || !trigger || !hasOlderMessages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (isLoadingOlder || !hasOlderMessages) return;
        if (document.hidden) return;

        // Hard guard: never trigger before the user has actually scrolled.
        // On first mount the bottom-pin runs after layout, and during that
        // window the trigger sentinel can be "intersecting" simply because
        // scrollTop is still 0. Firing here causes the visible upward jolt
        // on iOS right after the chat opens. Require a real user scroll
        // (lastScrollAtRef is set by the scroll listener above) before we
        // ever consider fetching older pages.
        if (lastScrollAtRef.current === 0) return;

        // Also require the user to have moved meaningfully away from the
        // bottom — short threads should never auto-paginate on open.
        const distanceFromBottom =
          scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
        if (distanceFromBottom < 200) return;

        const sinceScroll = performance.now() - lastScrollAtRef.current;
        if (sinceScroll < IDLE_GATE_MS) {
          // User is mid-flick — re-check shortly so we don't miss the window.
          window.setTimeout(() => {
            const stillIntersecting =
              trigger.getBoundingClientRect().top <
              scrollRoot.getBoundingClientRect().bottom + 2000;
            if (stillIntersecting && hasOlderMessages && !isLoadingOlder) {
              onTrigger();
            }
          }, IDLE_GATE_MS);
          return;
        }

        onTrigger();
      },
      {
        root: scrollRoot,
        // Pre-fetch BEFORE the user reaches the very top so the next page is
        // already prepended by the time their finger gets there.
        rootMargin: "300px 0px 0px 0px",
        threshold: 0,
      },
    );

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [
    scrollContainerRef,
    loadTriggerRef,
    enabled,
    hasOlderMessages,
    isLoadingOlder,
    onTrigger,
  ]);

  /**
   * Wrap your cache prepend in this. It:
   *  - snapshots scroll metrics
   *  - runs your `applyPrepend` callback inside flushSync
   *  - corrects scrollTop in the same task (no paint between)
   *  - re-corrects after recently-decoded images settle
   */
  const anchoredPrepend = useCallback(
    (applyPrepend: () => void) => {
      const container = scrollContainerRef.current;
      if (!container) {
        applyPrepend();
        return;
      }

      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;
      const previousBehavior = container.style.scrollBehavior;

      // Disable any inherited smooth-scroll while we hard-set scrollTop.
      container.style.scrollBehavior = "auto";

      // flushSync forces React to commit (and the browser to lay out) the
      // new DOM synchronously, so we can read the new scrollHeight and
      // restore scrollTop before any paint occurs.
      try {
        flushSync(() => {
          applyPrepend();
        });
      } catch {
        // flushSync throws if called from inside a render — fall back to
        // a normal update + rAF restore.
        applyPrepend();
        requestAnimationFrame(() => {
          const c = scrollContainerRef.current;
          if (!c) return;
          c.scrollTop = previousScrollTop + (c.scrollHeight - previousScrollHeight);
          c.style.scrollBehavior = previousBehavior;
        });
        return;
      }

      const nextScrollHeight = container.scrollHeight;
      const delta = nextScrollHeight - previousScrollHeight;
      container.scrollTop = previousScrollTop + delta;

      // Restore scroll-behavior on the next frame so we don't fight any
      // legitimate smooth-scroll that follows.
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.style.scrollBehavior = previousBehavior;
        }
      });

      // Watch for newly-prepended images decoding and re-apply the anchor
      // so their final height doesn't push content down later.
      watchPrependedImagesAndReanchor(container, previousScrollTop, previousScrollHeight);
    },
    [scrollContainerRef],
  );

  return { anchoredPrepend };
}

function watchPrependedImagesAndReanchor(
  container: HTMLElement,
  previousScrollTop: number,
  previousScrollHeight: number,
) {
  // Only watch images currently above the user's viewport (the ones we
  // just prepended). Newly-decoded images below would belong to the
  // pin-to-bottom flow, not us.
  const visibleTop = previousScrollTop;
  const candidates = Array.from(container.querySelectorAll("img")).filter((img) => {
    if (img.complete && img.naturalHeight > 0) return false;
    const rect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return rect.bottom - containerRect.top < visibleTop + 50;
  });

  if (!candidates.length) return;

  let stopped = false;
  const stop = () => {
    stopped = true;
    candidates.forEach((img) => {
      img.removeEventListener("load", onImgLoad);
      img.removeEventListener("error", onImgLoad);
    });
  };

  const onImgLoad = () => {
    if (stopped) return;
    const next = container.scrollHeight;
    const delta = next - previousScrollHeight;
    container.scrollTop = previousScrollTop + delta;
  };

  candidates.forEach((img) => {
    img.addEventListener("load", onImgLoad, { once: true });
    img.addEventListener("error", onImgLoad, { once: true });
  });

  window.setTimeout(stop, POST_RESTORE_IMAGE_WATCH_MS);
}
