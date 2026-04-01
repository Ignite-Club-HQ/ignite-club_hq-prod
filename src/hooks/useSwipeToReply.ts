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
    triggered: boolean;
  } | null>(null);

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
        triggered: false,
      };
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
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        ref.locked = true;
        // Only swipe right (positive deltaX) and horizontal dominant
        ref.isSwiping = deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY);
        if (!ref.isSwiping) return;
      }

      if (!ref.isSwiping) return;

      ref.currentX = touch.clientX;
      // Clamp: only allow right swipe, with rubber-band past threshold
      const rawOffset = Math.max(0, deltaX);
      const offset =
        rawOffset <= threshold
          ? rawOffset
          : threshold + (rawOffset - threshold) * 0.3;

      setSwipeState({ offsetX: offset, isSwiping: true });

      if (rawOffset >= threshold && !ref.triggered) {
        ref.triggered = true;
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(10);
      }
    },
    [enabled, threshold]
  );

  const onTouchEnd = useCallback(() => {
    const ref = touchRef.current;
    if (!ref || !ref.isSwiping) {
      touchRef.current = null;
      return;
    }

    const deltaX = ref.currentX - ref.startX;
    if (deltaX >= threshold) {
      onReply();
    }

    setSwipeState({ offsetX: 0, isSwiping: false });
    touchRef.current = null;
  }, [threshold, onReply]);

  return {
    swipeState,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
