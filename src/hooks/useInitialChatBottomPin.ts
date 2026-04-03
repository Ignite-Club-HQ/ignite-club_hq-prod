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
 * then snap once and reveal. Much simpler than the previous rAF-loop approach,
 * eliminating scroll thrash during the stabilisation window.
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

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  useLayoutEffect(() => {
    if (!enabled) {
      setIsPinned(true);
      return;
    }

    // Once pinned for this key, stay pinned — never flash visibility:hidden again.
    // The only re-pin case is a genuinely new resetKey (navigating to a different chat).
    if (pinnedKeyRef.current === resetKey) {
      // If we pinned while empty and content has now arrived, just re-snap
      // to the bottom without hiding. This avoids the flash.
      // Use multi-pass rAF to ensure DOM has rendered the new messages.
      if (pinnedWhileEmptyRef.current && itemCount > 0) {
        pinnedWhileEmptyRef.current = false;
        // First pass: immediate snap
        scrollChatToBottom(scrollContainerRef.current);
        // Second pass: after React commit & browser paint
        requestAnimationFrame(() => {
          scrollChatToBottom(scrollContainerRef.current);
          // Third pass: catch any async image/layout shifts
          requestAnimationFrame(() => {
            scrollChatToBottom(scrollContainerRef.current);
            // Final pass after a short delay for any remaining layout
            setTimeout(() => {
              scrollChatToBottom(scrollContainerRef.current);
            }, 150);
          });
        });
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
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;
    const STABILITY_MS = 100;
    const MAX_WAIT_MS = 1500;
    const BOTTOM_THRESHOLD_PX = 2;
    const MAX_SETTLE_ATTEMPTS = 8;

    const cleanup = () => {
      observer?.disconnect();
      mountObserver?.disconnect();
      resizeObserver?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (maxTimer) clearTimeout(maxTimer);
      cancelAnimationFrame(rafId);
    };

    const reveal = () => {
      pinnedKeyRef.current = resetKey;
      setIsPinned(true);
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

  // On resume: remember whether we were near bottom, then re-snap after
  // query refetch re-renders messages. Uses a MutationObserver with a longer
  // settle window to survive the full invalidate→fetch→render cycle.
  useEffect(() => {
    if (!isPinned) return;

    let wasNearBottom = true;
    let observer: MutationObserver | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let snapInterval: ReturnType<typeof setInterval> | null = null;

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        // Remember scroll position before app goes to background
        const viewport = resolveChatScrollViewport(scrollContainerRef.current);
        if (viewport) {
          const maxScroll = viewport.scrollHeight - viewport.clientHeight;
          wasNearBottom = maxScroll - viewport.scrollTop < 150;
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !wasNearBottom) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      // Immediate snap for cached content
      scrollChatToBottom(scrollContainerRef.current);

      // Watch for DOM mutations from query refetch, snap on each change
      observer?.disconnect();
      observer = new MutationObserver(() => {
        scrollChatToBottom(scrollContainerRef.current);
      });
      observer.observe(viewport, { childList: true, subtree: true });

      // Also poll-snap every 100ms to catch any React re-render gaps
      // the MutationObserver might miss (e.g. full list replacement)
      if (snapInterval) clearInterval(snapInterval);
      snapInterval = setInterval(() => {
        scrollChatToBottom(scrollContainerRef.current);
      }, 100);

      // Stop after 2s settle window — covers slow network refetch
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        if (snapInterval) { clearInterval(snapInterval); snapInterval = null; }
        // Final snap
        requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
      }, 2000);
    };

    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer?.disconnect();
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (snapInterval) clearInterval(snapInterval);
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isPinned, scrollContainerRef]);

  return { isPinned };
}
