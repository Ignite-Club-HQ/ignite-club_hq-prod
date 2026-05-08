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

const IDLE_GATE_MS = 90;
const PREFETCH_ROOT_MARGIN_PX = 1200;
const POST_RESTORE_IMAGE_WATCH_MS = 1500;
const MIN_TRIGGER_INTERVAL_MS = 250;

export function useChatOlderMessagesAnchor({
  scrollContainerRef,
  loadTriggerRef,
  hasOlderMessages,
  isLoadingOlder,
  enabled = true,
  onTrigger,
}: UseChatOlderMessagesAnchorOptions) {
  const lastScrollAtRef = useRef(0);
  const lastTriggerAtRef = useRef(0);

  const triggerOlder = useCallback(() => {
    const now = performance.now();
    if (now - lastTriggerAtRef.current < MIN_TRIGGER_INTERVAL_MS) return;
    lastTriggerAtRef.current = now;
    onTrigger();
  }, [onTrigger]);

  // Track "recently scrolled" so the IntersectionObserver below knows the
  // user has actually moved the viewport (vs. our own bottom-pin writes
  // that fire synthetic scroll events on first open).
  //
  // CRITICAL: only stamp when the user is meaningfully away from the
  // bottom. The initial bottom-pin sequence performs many programmatic
  // `scrollTop = scrollHeight - clientHeight` writes that each fire a real
  // "scroll" event; if we stamped on every event, the very first paint
  // after a fresh install would set lastScrollAtRef and let the
  // older-messages observer fire on the next tick — the jolt the user
  // sees on first thread open after install.
  //
  // This handler intentionally does NOT call triggerOlder. The
  // IntersectionObserver below is the single source of truth for deciding
  // when to fetch the next page; having two redundant trigger paths
  // (scroll-distance threshold + IO sentinel) caused multiple flushSync
  // re-renders during a single fast upward flick — which the user
  // perceived as "viewport jumps and shifts unexpectedly".
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance =
        container.scrollHeight - container.clientHeight - container.scrollTop;
      if (distance < 200) return;
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
          // User is mid-flick — re-check very shortly so older pages begin
          // loading while momentum is still carrying the user into history.
          window.setTimeout(() => {
            const stillIntersecting =
              trigger.getBoundingClientRect().top <
              scrollRoot.getBoundingClientRect().bottom + PREFETCH_ROOT_MARGIN_PX;
            // Re-apply ALL guards inside the deferred path. Without these,
            // a programmatic scrollTop set by the initial bottom-pin (which
            // fires a real "scroll" event and stamps lastScrollAtRef) lands
            // us in this branch on first open and then unconditionally calls
            // onTrigger — causing the first-load older-messages fetch and
            // the visible upward jolt the user reports after a fresh install.
            const distance =
              scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
            if (
              stillIntersecting &&
              hasOlderMessages &&
              !isLoadingOlder &&
              !document.hidden &&
              distance >= 200
            ) {
              triggerOlder();
            }
          }, IDLE_GATE_MS);
          return;
        }

        triggerOlder();
      },
      {
        root: scrollRoot,
        // Pre-fetch well BEFORE the user reaches the very top so the next
        // page is already prepended by the time their finger gets there.
        rootMargin: `${PREFETCH_ROOT_MARGIN_PX}px 0px 0px 0px`,
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
    triggerOlder,
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

      void container.offsetHeight;
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
      watchPrependedMediaAndReanchor(container, previousScrollTop, previousScrollHeight);
    },
    [scrollContainerRef],
  );

  return { anchoredPrepend };
}

function watchPrependedMediaAndReanchor(
  container: HTMLElement,
  previousScrollTop: number,
  previousScrollHeight: number,
) {
  // Only watch media currently above the user's viewport (the ones we
  // just prepended). Newly-decoded images below would belong to the
  // pin-to-bottom flow, not us.
  const candidates = Array.from(container.querySelectorAll("img, video")).filter((media) => {
    if (media instanceof HTMLImageElement && media.complete && media.naturalHeight > 0) return false;
    if (media instanceof HTMLVideoElement && media.readyState >= 1) return false;
    const rect = media.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return rect.bottom <= containerRect.top + 80;
  });

  if (!candidates.length) return;

  let stopped = false;
  const stop = () => {
    stopped = true;
    candidates.forEach((media) => {
      media.removeEventListener("load", onMediaLoad);
      media.removeEventListener("loadedmetadata", onMediaLoad);
      media.removeEventListener("loadeddata", onMediaLoad);
      media.removeEventListener("error", onMediaLoad);
    });
  };

  // Incremental anchoring: each media-load delta is added to the user's
  // CURRENT scrollTop (not the captured `previousScrollTop`). This way, if
  // the user keeps scrolling up after the prepend, we don't yank them back
  // to where they were when the page was fetched — we just absorb the
  // newly-resolved image height under their current finger position.
  let lastScrollHeight = container.scrollHeight;

  const onMediaLoad = () => {
    if (stopped) return;
    const nextHeight = container.scrollHeight;
    const delta = nextHeight - lastScrollHeight;
    lastScrollHeight = nextHeight;
    if (delta === 0) return;
    // Only compensate when the media that grew sits ABOVE the user's
    // current viewport — otherwise the layout shift didn't push their
    // visible content and we'd just create a phantom jump.
    // Cheap heuristic: any positive delta from above-the-fold images
    // (which is the candidate set we filtered to) needs compensation.
    container.scrollTop = container.scrollTop + delta;
  };

  candidates.forEach((media) => {
    media.addEventListener("load", onMediaLoad, { once: true });
    media.addEventListener("loadedmetadata", onMediaLoad, { once: true });
    media.addEventListener("loadeddata", onMediaLoad, { once: true });
    media.addEventListener("error", onMediaLoad, { once: true });
  });

  window.setTimeout(stop, POST_RESTORE_IMAGE_WATCH_MS);
  // Mark the captured baseline as "consumed" so static analysis doesn't
  // flag it; the values are intentionally only used by the initial
  // post-prepend correction in the caller.
  void previousScrollTop;
  void previousScrollHeight;
}
