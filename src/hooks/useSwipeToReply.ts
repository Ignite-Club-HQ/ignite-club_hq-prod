import { useRef, useCallback, useState, useEffect } from "react";

// Global registry: when any message reveals reply, others dismiss
type ResetFn = () => void;
const activeResets = new Set<ResetFn>();
let globalDismissAttached = false;

function attachGlobalDismiss() {
  if (globalDismissAttached) return;
  globalDismissAttached = true;
  document.addEventListener("touchstart", () => {
    // Each swipe's own onTouchStart will re-arm — this clears stale ones
    // Delay slightly so the new swipe's onTouchStart registers first
    setTimeout(() => {
      activeResets.forEach((fn) => fn());
    }, 50);
  }, { passive: true });
}

function notifyReveal(currentReset: ResetFn) {
  activeResets.forEach((fn) => {
    if (fn !== currentReset) fn();
  });
}

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

  const resetReplyReveal = useCallback(() => {
    setSwipeState({
      offsetX: 0,
      isSwiping: false,
      isReplyRevealed: false,
    });
  }, []);

  // Register this instance's reset in the global set
  useEffect(() => {
    activeResets.add(resetReplyReveal);
    attachGlobalDismiss();
    return () => {
      activeResets.delete(resetReplyReveal);
    };
  }, [resetReplyReveal]);

  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    locked: boolean;
    isSwiping: boolean;
  } | null>(null);

  const hapticFiredRef = useRef(false);
  const isRevealedRef = useRef(false);

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

    const wasRevealed = swipeState.isReplyRevealed || (ref.currentX - ref.startX >= threshold);

    setSwipeState((current) => ({
      offsetX: 0,
      isSwiping: false,
      isReplyRevealed: current.isReplyRevealed,
    }));
    hapticFiredRef.current = false;
    touchRef.current = null;

    // If this message just revealed, dismiss all others
    if (wasRevealed) {
      isRevealedRef.current = true;
      notifyReveal(resetReplyReveal);
    }
  }, [threshold, swipeState.isReplyRevealed, resetReplyReveal]);

  // Keep ref in sync
  useEffect(() => {
    isRevealedRef.current = swipeState.isReplyRevealed;
  }, [swipeState.isReplyRevealed]);

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
