import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getChatScrollMetrics, resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";

interface UseInitialChatBottomPinOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  bottomAnchorRef?: RefObject<HTMLElement>;
  itemCount: number;
  resetKey?: string | number | null;
  enabled?: boolean;
  onPinned?: () => void;
}

/**
 * Pins a chat scroll container to the bottom on initial load.
 *
 * Strategy: wait for content to appear and layout to stabilise (quiet for 80ms),
 * then snap once and reveal. Once the user scrolls away from the bottom, all
 * automatic snapping is suppressed until the next navigation (resetKey change).
 */
export function useInitialChatBottomPin({
  scrollContainerRef,
  bottomAnchorRef,
  itemCount,
  resetKey,
  enabled = true,
  onPinned,
}: UseInitialChatBottomPinOptions) {
  const pinnedKeyRef = useRef<string | number | null | undefined>(undefined);
  const onPinnedRef = useRef(onPinned);
  const [isPinned, setIsPinned] = useState(false);
  // Track if we "pinned" due to empty content so we can re-pin when data arrives
  const pinnedWhileEmptyRef = useRef(false);
  // Once the user scrolls away from bottom, suppress all automatic snapping
  const userScrolledAwayRef = useRef(false);
  // Track last known item count per resetKey so we can re-snap when fresh
  // network data arrives after the initial cached render (iOS cold start).
  const lastItemCountRef = useRef(0);

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  // Reset the user-scrolled flag whenever the chat changes
  useEffect(() => {
    userScrolledAwayRef.current = false;
  }, [resetKey]);

  // Detect manual scrolling away from bottom to suppress auto-snap
  useEffect(() => {
    if (!isPinned) return;

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const metrics = getChatScrollMetrics(scrollContainerRef.current);
        if (metrics && metrics.distanceFromBottom > 200) {
          userScrolledAwayRef.current = true;
        }
      });
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [isPinned, scrollContainerRef, resetKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      setIsPinned(true);
      return;
    }

    if (pinnedKeyRef.current === resetKey) {
      if (pinnedWhileEmptyRef.current && itemCount > 0) {
        pinnedWhileEmptyRef.current = false;
        scrollChatToBottom(scrollContainerRef.current);
        requestAnimationFrame(() => {
          scrollChatToBottom(scrollContainerRef.current);
          requestAnimationFrame(() => {
            scrollChatToBottom(scrollContainerRef.current);
          });
        });

        // Brief resize guard — only snap if user hasn't scrolled away
        const viewport = resolveChatScrollViewport(scrollContainerRef.current);
        if (viewport && typeof ResizeObserver !== "undefined") {
          const guardObserver = new ResizeObserver(() => {
            if (!userScrolledAwayRef.current) {
              scrollChatToBottom(scrollContainerRef.current);
            }
          });
          guardObserver.observe(viewport);
          setTimeout(() => guardObserver.disconnect(), 1000);
        }
      }
      return;
    }

    if (itemCount <= 0) {
      pinnedWhileEmptyRef.current = true;
      setIsPinned(true);
      pinnedKeyRef.current = resetKey;
      return;
    }

    pinnedWhileEmptyRef.current = false;
    setIsPinned(false);

    let cancelled = false;
    let finalizing = false;
    let observer: MutationObserver | null = null;
    let mountObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let postPinResizeObserver: ResizeObserver | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let postPinTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;
    const STABILITY_MS = 100;
    const MAX_WAIT_MS = 1500;
    const POST_PIN_GUARD_MS = 1200;
    const BOTTOM_THRESHOLD_PX = 2;
    const MAX_SETTLE_ATTEMPTS = 8;

    const cleanup = () => {
      observer?.disconnect();
      mountObserver?.disconnect();
      resizeObserver?.disconnect();
      postPinResizeObserver?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (postPinTimer) clearTimeout(postPinTimer);
      cancelAnimationFrame(rafId);
    };

    const guardSnap = () => {
      if (cancelled || userScrolledAwayRef.current) return;
      scrollChatToBottom(scrollContainerRef.current);
    };

    const startPostPinGuard = () => {
      if (cancelled) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      // Only watch for resize changes (layout shifts), not DOM mutations
      // which fire on every render and fight user scrolling
      postPinResizeObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        postPinResizeObserver = new ResizeObserver(() => guardSnap());
        postPinResizeObserver.observe(viewport);
      }

      guardSnap();
      postPinTimer = setTimeout(() => {
        postPinResizeObserver?.disconnect();
        postPinResizeObserver = null;
      }, POST_PIN_GUARD_MS);
    };

    const reveal = () => {
      pinnedKeyRef.current = resetKey;
      setIsPinned(true);
      startPostPinGuard();
      onPinnedRef.current?.();
    };

    const settleAtBottom = (attemptsLeft = MAX_SETTLE_ATTEMPTS) => {
      if (cancelled) return;

      scrollChatToBottom(scrollContainerRef.current);
      rafId = requestAnimationFrame(() => {
        if (cancelled) return;

        scrollChatToBottom(scrollContainerRef.current);
        const firstMetrics = getChatScrollMetrics(scrollContainerRef.current);

        rafId = requestAnimationFrame(() => {
          if (cancelled) return;

          scrollChatToBottom(scrollContainerRef.current);
          const secondMetrics = getChatScrollMetrics(scrollContainerRef.current);
          const firstSettled = !firstMetrics || firstMetrics.distanceFromBottom <= BOTTOM_THRESHOLD_PX;
          const secondSettled = !secondMetrics || secondMetrics.distanceFromBottom <= BOTTOM_THRESHOLD_PX;

          if ((!firstSettled || !secondSettled) && attemptsLeft > 0) {
            settleAtBottom(attemptsLeft - 1);
            return;
          }

          reveal();
        });
      });
    };

    const finalize = () => {
      if (cancelled || finalizing) return;
      finalizing = true;
      cleanup();
      settleAtBottom();
    };

    const scheduleFinalize = () => {
      if (cancelled || finalizing) return;
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(finalize, STABILITY_MS);
    };

    const attachToViewport = () => {
      if (cancelled) return false;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return false;

      observer?.disconnect();
      observer = new MutationObserver(() => {
        if (cancelled || finalizing) return;
        const vp = resolveChatScrollViewport(scrollContainerRef.current);
        if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
        scheduleFinalize();
      });
      observer.observe(viewport, { childList: true, subtree: true, characterData: true });

      resizeObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (cancelled || finalizing) return;
          const vp = resolveChatScrollViewport(scrollContainerRef.current);
          if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
          scheduleFinalize();
        });

        resizeObserver.observe(viewport);

        const contentTarget =
          bottomAnchorRef?.current?.parentElement ??
          viewport.firstElementChild ??
          viewport;

        if (contentTarget instanceof HTMLElement && contentTarget !== viewport) {
          resizeObserver.observe(contentTarget);
        }
      }

      scheduleFinalize();
      return true;
    };

    if (!attachToViewport()) {
      const root = scrollContainerRef.current?.parentElement ?? document.body;
      mountObserver = new MutationObserver(() => {
        if (attachToViewport()) {
          mountObserver?.disconnect();
        }
      });
      mountObserver.observe(root, { childList: true, subtree: true });

      const retry = () => {
        if (cancelled) return;
        if (!attachToViewport()) {
          rafId = requestAnimationFrame(retry);
        }
      };
      rafId = requestAnimationFrame(retry);
    }

    maxTimer = setTimeout(() => {
      if (cancelled) return;
      finalize();
    }, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      cleanup();
      if (pinnedKeyRef.current !== resetKey) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  // On resume: snap to bottom only if user was already near bottom.
  // Uses a short observation window instead of aggressive polling.
  useEffect(() => {
    if (!isPinned) return;

    let wasNearBottom = true;
    let observer: MutationObserver | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        const viewport = resolveChatScrollViewport(scrollContainerRef.current);
        if (viewport) {
          const maxScroll = viewport.scrollHeight - viewport.clientHeight;
          wasNearBottom = maxScroll - viewport.scrollTop < 150;
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !wasNearBottom || userScrolledAwayRef.current) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      scrollChatToBottom(scrollContainerRef.current);

      observer?.disconnect();
      observer = new MutationObserver(() => {
        if (!userScrolledAwayRef.current) {
          scrollChatToBottom(scrollContainerRef.current);
        }
      });
      observer.observe(viewport, { childList: true, subtree: true });

      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        if (!userScrolledAwayRef.current) {
          requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
        }
      }, 1500);
    };

    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer?.disconnect();
      if (watchdogTimer) clearTimeout(watchdogTimer);
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isPinned, scrollContainerRef]);

  return { isPinned };
}
