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

    const snapToBottom = () => {
      const target = scrollContainerRef.current;
      if (!target) return;
      target.scrollTop = target.scrollHeight;
    };

    snapToBottom();
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(snapToBottom);
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [enabled, itemCount, resetKey, scrollContainerRef]);
}