import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

import { resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";

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

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  useLayoutEffect(() => {
    if (!enabled) {
      setIsPinned(true);
      return;
    }

    if (pinnedKeyRef.current === resetKey) return;

    if (itemCount <= 0) {
      setIsPinned(true);
      return;
    }

    setIsPinned(false);

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let mountObserver: MutationObserver | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;
    const STABILITY_MS = 80;
    const MAX_WAIT_MS = 1200;

    const cleanup = () => {
      observer?.disconnect();
      mountObserver?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (maxTimer) clearTimeout(maxTimer);
      cancelAnimationFrame(rafId);
    };

    const finalize = () => {
      if (cancelled) return;
      cancelled = true;
      cleanup();

      scrollChatToBottom(scrollContainerRef.current);
      requestAnimationFrame(() => {
        scrollChatToBottom(scrollContainerRef.current);
        pinnedKeyRef.current = resetKey;
        setIsPinned(true);
        onPinnedRef.current?.();
      });
    };

    const scheduleFinalize = () => {
      if (cancelled) return;
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(finalize, STABILITY_MS);
    };

    const attachToViewport = () => {
      if (cancelled) return false;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return false;

      if (viewport.scrollHeight > viewport.clientHeight + 10) {
        finalize();
        return true;
      }

      observer?.disconnect();
      observer = new MutationObserver(() => {
        if (cancelled) return;
        const vp = resolveChatScrollViewport(scrollContainerRef.current);
        if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
        scheduleFinalize();
      });

      observer.observe(viewport, { childList: true, subtree: true, characterData: true });
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

  // On native: re-snap on app resume using a MutationObserver
  // to react to actual DOM changes (query refetch) rather than blind timeouts.
  useEffect(() => {
    if (!isPinned || !Capacitor.isNativePlatform()) return;

    let observer: MutationObserver | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      // Immediate snap for cached content
      scrollChatToBottom(scrollContainerRef.current);

      // Watch for DOM mutations from query refetch, snap on each change
      observer?.disconnect();
      observer = new MutationObserver(() => {
        requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
      });
      observer.observe(viewport, { childList: true, subtree: true });

      // Stop observing after a settle window — refetch should complete within 800ms
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        // Final snap after observer detaches
        requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
      }, 800);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      observer?.disconnect();
      if (watchdogTimer) clearTimeout(watchdogTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isPinned, scrollContainerRef, resetKey]);

  return { isPinned };
}
