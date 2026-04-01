import { useRef, useCallback, useState, useEffect } from "react";

// Global registry: when any message reveals reply, others dismiss
type ResetFn = () => void;
const activeResets = new Set<ResetFn>();

interface UseSwipeToReplyOptions {
  enabled?: boolean;
  threshold?: number;
  onReply?: () => void;
}

interface SwipeToReplyState {
  offsetX: number;
  isSwiping: boolean;
}

export function useSwipeToReply({
  enabled = true,
  threshold = 80,
  onReply,
}: UseSwipeToReplyOptions) {
  const [swipeState, setSwipeState] = useState<SwipeToReplyState>({
    offsetX: 0,
    isSwiping: false,
  });

  const resetReplyReveal = useCallback(() => {
    setSwipeState({ offsetX: 0, isSwiping: false });
  }, []);

  useEffect(() => {
    activeResets.add(resetReplyReveal);
    return () => { activeResets.delete(resetReplyReveal); };
  }, [resetReplyReveal]);

  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    locked: boolean;
    isSwiping: boolean;
  } | null>(null);

  const hapticFiredRef = useRef(false);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

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

    // Haptic tick when crossing threshold
    if (deltaX >= threshold && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
    }

    setSwipeState({ offsetX: offset, isSwiping: true });
  }, [enabled, threshold]);

  const onTouchEnd = useCallback(() => {
    const ref = touchRef.current;

    if (!ref || !ref.isSwiping) {
      touchRef.current = null;
      return;
    }

    const deltaX = ref.currentX - ref.startX;
    const passedThreshold = deltaX >= threshold;

    // Snap back
    setSwipeState({ offsetX: 0, isSwiping: false });
    hapticFiredRef.current = false;
    touchRef.current = null;

    // Trigger reply immediately on release if past threshold
    if (passedThreshold && onReplyRef.current) {
      onReplyRef.current();
    }
  }, [threshold]);

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
