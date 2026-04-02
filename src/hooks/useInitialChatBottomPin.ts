import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";

interface UseInitialChatBottomPinOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  bottomAnchorRef?: RefObject<HTMLElement>;
  itemCount: number;
  resetKey?: string | number | null;
  enabled?: boolean;
  onPinned?: () => void;
}

export function useInitialChatBottomPin({
  scrollContainerRef,
  bottomAnchorRef,
  itemCount,
  resetKey,
  enabled = true,
  onPinned,
}: UseInitialChatBottomPinOptions) {
  const hasPinnedRef = useRef(false);
  const onPinnedRef = useRef(onPinned);
  // Start visible (true) so content is never permanently hidden
  const [isPinned, setIsPinned] = useState(true);

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  useEffect(() => {
    hasPinnedRef.current = false;
    setIsPinned(true); // Reset to visible on key change
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled || itemCount <= 0 || hasPinnedRef.current) return;

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) return;

    // Briefly hide while we position
    setIsPinned(false);

    const snapToBottom = () => {
      scrollChatToBottom(scrollContainerRef.current);
    };

    // Immediate snap
    snapToBottom();

    // Double-rAF to ensure DOM is fully laid out
    let raf1 = 0;
    let raf2 = 0;
    let settleTimeout = 0;
    let maxTimeout = 0;
    let resizeObserver: ResizeObserver | null = null;
    let didFinalize = false;

    const finalize = () => {
      if (didFinalize) return;
      didFinalize = true;
      hasPinnedRef.current = true;
      snapToBottom();
      setIsPinned(true);
      resizeObserver?.disconnect();
      resizeObserver = null;
      onPinnedRef.current?.();
    };

    const scheduleSettle = () => {
      window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(finalize, 120);
    };

    raf1 = requestAnimationFrame(() => {
      snapToBottom();
      raf2 = requestAnimationFrame(() => {
        snapToBottom();
        // If no ResizeObserver, finalize now
        if (typeof ResizeObserver === "undefined") {
          finalize();
        }
      });
    });

    // Use ResizeObserver to wait for layout to settle
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        snapToBottom();
        scheduleSettle();
      });

      resizeObserver.observe(viewport);
      const content = viewport.firstElementChild;
      if (content instanceof HTMLElement) {
        resizeObserver.observe(content);
      }
      const anchor = bottomAnchorRef?.current;
      if (anchor) {
        resizeObserver.observe(anchor);
      }

      scheduleSettle();
      // Safety: always show after 250ms max
      maxTimeout = window.setTimeout(finalize, 250);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(settleTimeout);
      window.clearTimeout(maxTimeout);
      resizeObserver?.disconnect();
      // Fail open: if cleanup runs before finalize, ensure visible
      if (!didFinalize) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  return { isPinned };
}
