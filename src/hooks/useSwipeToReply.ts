import { useRef, useCallback, useState } from "react";

interface UseSwipeToReplyOptions {
  enabled?: boolean;
  threshold?: number;
}

interface SwipeToReplyState {
  offsetX: number;
  isSwiping: boolean;
  isReplyRevealed: boolean;
}

export function useSwipeToReply({
  enabled = true,
  threshold = 80,
}: UseSwipeToReplyOptions) {
  const [swipeState, setSwipeState] = useState<SwipeToReplyState>({
    offsetX: 0,
    isSwiping: false,
    isReplyRevealed: false,
  });

  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    locked: boolean;
    isSwiping: boolean;
  } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      locked: false,
      isSwiping: false,
    };
  }, [enabled]);

  const hapticFiredRef = useRef(false);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = touchRef.current;
    if (!enabled || !ref) return;

    const touch = e.touches[0];
    const deltaX = Math.max(0, touch.clientX - ref.startX);
    const deltaY = Math.abs(touch.clientY - ref.startY);

    if (!ref.locked) {
      if (deltaX < 10 && deltaY < 10) return;
      ref.locked = true;
      ref.isSwiping = deltaX > 0 && deltaX > deltaY * 1.2;
      if (!ref.isSwiping) return;
      hapticFiredRef.current = false;
    }

    if (!ref.isSwiping) return;

    ref.currentX = touch.clientX;
    const offset = deltaX <= threshold ? deltaX : threshold + (deltaX - threshold) * 0.3;
    const justRevealed = deltaX >= threshold;

    // Haptic tick when crossing threshold
    if (justRevealed && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
    }

    setSwipeState({
      offsetX: offset,
      isSwiping: true,
      isReplyRevealed: justRevealed,
    });
  }, [enabled, threshold]);

  const onTouchEnd = useCallback(() => {
    const ref = touchRef.current;

    if (!ref || !ref.isSwiping) {
      touchRef.current = null;
      return;
    }

    setSwipeState((current) => ({
      offsetX: 0,
      isSwiping: false,
      isReplyRevealed: current.isReplyRevealed,
    }));
    touchRef.current = null;
  }, []);

  const resetReplyReveal = useCallback(() => {
    setSwipeState({
      offsetX: 0,
      isSwiping: false,
      isReplyRevealed: false,
    });
  }, []);

  return {
    swipeState,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    resetReplyReveal,
  };
}
