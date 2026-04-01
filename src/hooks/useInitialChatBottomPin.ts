import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

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

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  useEffect(() => {
    hasPinnedRef.current = false;
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled || itemCount <= 0 || hasPinnedRef.current) return;

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) return;

    hasPinnedRef.current = true;

    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimeout = 0;
    let maxTimeout = 0;
    let resizeObserver: ResizeObserver | null = null;
    let didNotifyPinned = false;

    const notifyPinned = () => {
      if (didNotifyPinned) return;
      didNotifyPinned = true;
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
      maxTimeout = window.setTimeout(() => {
        finalizePin();
      }, 1200);
    }

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimeout);
      window.clearTimeout(maxTimeout);
      disconnectObserver();
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);
}