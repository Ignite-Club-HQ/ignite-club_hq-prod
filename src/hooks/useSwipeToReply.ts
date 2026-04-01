import { useRef, useCallback, useState } from "react";

interface UseSwipeToReplyOptions {
  onReply: () => void;
  enabled?: boolean;
  threshold?: number;
}

interface SwipeToReplyState {
  offsetX: number;
  isSwiping: boolean;
}

export function useSwipeToReply({
  onReply,
  enabled = true,
  threshold = 80,
}: UseSwipeToReplyOptions) {
  const [swipeState, setSwipeState] = useState<SwipeToReplyState>({
    offsetX: 0,
    isSwiping: false,
  });

  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    locked: boolean;
    isSwiping: boolean;
  } | null>(null);

  // Tracks whether the swipe is actively in progress (for external coordination)
  const isSwipingRef = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        locked: false,
        isSwiping: false,
      };
      isSwipingRef.current = false;
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const ref = touchRef.current;
      if (!ref || !enabled) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - ref.startX;
      const deltaY = touch.clientY - ref.startY;

      if (!ref.locked) {
        if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
        ref.locked = true;
        // Only swipe right (positive deltaX) and horizontal dominant
        ref.isSwiping = deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
        isSwipingRef.current = ref.isSwiping;
        if (!ref.isSwiping) return;
      }

      if (!ref.isSwiping) return;

      ref.currentX = touch.clientX;
      const rawOffset = Math.max(0, deltaX);
      const offset =
        rawOffset <= threshold
          ? rawOffset
          : threshold + (rawOffset - threshold) * 0.3;

      setSwipeState({ offsetX: offset, isSwiping: true });

      if (rawOffset >= threshold) {
        if (navigator.vibrate) navigator.vibrate(10);
      }
    },
    [enabled, threshold]
  );

  const onTouchEnd = useCallback(() => {
    const ref = touchRef.current;
    if (!ref || !ref.isSwiping) {
      touchRef.current = null;
      isSwipingRef.current = false;
      return;
    }

    const finalOffset = ref.currentX - ref.startX;
    
    // Reset state first so UI animates back
    setSwipeState({ offsetX: 0, isSwiping: false });
    touchRef.current = null;
    isSwipingRef.current = false;

    // Trigger reply if past threshold
    if (finalOffset >= threshold) {
      // Use rAF to let the animation start before triggering reply
      requestAnimationFrame(() => {
        onReply();
      });
    }
  }, [threshold, onReply]);

  return {
    swipeState,
    isSwipingRef,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
