import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

interface UseInitialChatBottomPinOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  itemCount: number;
  resetKey?: string | number | null;
  enabled?: boolean;
  onPinned?: () => void;
}

export function useInitialChatBottomPin({
  scrollContainerRef,
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

    const el = scrollContainerRef.current;
    if (!el) return;

    hasPinnedRef.current = true;
    onPinnedRef.current?.();

    let firstFrame = 0;
    let secondFrame = 0;
    let disconnectTimeout = 0;
    let resizeObserver: ResizeObserver | null = null;

    const snapToBottom = () => {
      const target = scrollContainerRef.current;
      if (!target) return;
      target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    };

    snapToBottom();
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(snapToBottom);
    });

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        snapToBottom();
      });

      resizeObserver.observe(el);

      const content = el.firstElementChild;
      if (content instanceof HTMLElement) {
        resizeObserver.observe(content);
      }

      disconnectTimeout = window.setTimeout(() => {
        snapToBottom();
        resizeObserver?.disconnect();
        resizeObserver = null;
      }, 250);
    }

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(disconnectTimeout);
      resizeObserver?.disconnect();
    };
  }, [enabled, itemCount, resetKey, scrollContainerRef]);
}