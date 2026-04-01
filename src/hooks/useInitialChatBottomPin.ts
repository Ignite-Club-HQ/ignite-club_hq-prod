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
    let settleTimeout = 0;
    let fallbackTimeout = 0;
    let observer: ResizeObserver | null = null;

    const snapToBottom = () => {
      const target = scrollContainerRef.current;
      if (!target) return;
      target.scrollTop = target.scrollHeight;
    };

    const scheduleSnap = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);

      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(snapToBottom);
      });
    };

    const finishSoon = () => {
      window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(() => {
        observer?.disconnect();
      }, 240);
    };

    scheduleSnap();
    fallbackTimeout = window.setTimeout(() => {
      scheduleSnap();
      finishSoon();
    }, 120);

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        scheduleSnap();
        finishSoon();
      });

      observer.observe(el);

      const contentEl = el.firstElementChild;
      if (contentEl instanceof HTMLElement) {
        observer.observe(contentEl);
      }
    }

    const handleViewportResize = () => {
      scheduleSnap();
      finishSoon();
    };

    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimeout);
      window.clearTimeout(fallbackTimeout);
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [enabled, itemCount, resetKey, scrollContainerRef]);
}