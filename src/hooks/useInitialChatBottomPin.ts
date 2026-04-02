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

    hasPinnedRef.current = true;
    // Hide while we position
    setIsPinned(false);

    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimeout = 0;
    let maxTimeout = 0;
    let resizeObserver: ResizeObserver | null = null;
    let didNotifyPinned = false;

    const notifyPinned = () => {
      if (didNotifyPinned) return;
      didNotifyPinned = true;
      setIsPinned(true);
      onPinnedRef.current?.();
    };

    const snapToBottom = () => {
      scrollChatToBottom(scrollContainerRef.current);
    };

    const disconnectObserver = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    const finalizePin = () => {
      snapToBottom();
      disconnectObserver();
      notifyPinned();
    };

    const scheduleSettle = () => {
      window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(() => {
        finalizePin();
      }, 120);
    };

    snapToBottom();
    firstFrame = requestAnimationFrame(() => {
      snapToBottom();
      secondFrame = requestAnimationFrame(() => {
        snapToBottom();

        if (typeof ResizeObserver === "undefined") {
          notifyPinned();
        }
      });
    });

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
      maxTimeout = window.setTimeout(() => {
        finalizePin();
      }, 250);
    }

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimeout);
      window.clearTimeout(maxTimeout);
      disconnectObserver();
      // Fail open: if cleanup runs before pin completes, ensure visible
      if (!didNotifyPinned) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  return { isPinned };
}
