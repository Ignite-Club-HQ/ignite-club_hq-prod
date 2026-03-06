import { useState, useRef, useCallback, useEffect, RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
  scrollableRef?: RefObject<HTMLDivElement>;
}

const isNative = () => !!(window as any).Capacitor?.isNativePlatform?.();

export function usePullToRefresh({
  onRefresh,
  threshold = 100,
  disabled = false,
  scrollableRef,
}: UsePullToRefreshOptions) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  
  const startY = useRef(0);
  const currentY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtTopRef = useRef(false);
  const isPullingRef = useRef(false);
  const touchActiveRef = useRef(false);

  const getScrollTop = useCallback(() => {
    if (scrollableRef?.current) {
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport.scrollTop ?? 0;
      return scrollableRef.current.scrollTop ?? 0;
    }
    const container = containerRef.current;
    return container?.scrollTop ?? 0;
  }, [scrollableRef]);

  const getScrollElement = useCallback((): HTMLElement | null => {
    if (scrollableRef?.current) {
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport as HTMLElement;
      return scrollableRef.current;
    }
    return containerRef.current;
  }, [scrollableRef]);

  // Dynamically toggle touch-action on scroll element to prevent native
  // overscroll from claiming the gesture when we're at the top
  const setTouchAction = useCallback((value: string) => {
    const el = getScrollElement();
    if (el) {
      el.style.touchAction = value;
    }
  }, [getScrollElement]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Always record start position — we decide in touchmove whether to pull
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    touchActiveRef.current = true;
    isPullingRef.current = false;
    
    const scrollTop = getScrollTop();
    isAtTopRef.current = scrollTop <= 5;
    
    // When at top, prevent the browser from claiming the gesture
    if (isAtTopRef.current) {
      setTouchAction('none');
    }
  }, [disabled, isRefreshing, getScrollTop, setTouchAction]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing || !touchActiveRef.current) return;
    
    const scrollTop = getScrollTop();
    
    // Re-check if we've reached the top during this gesture
    if (!isAtTopRef.current && scrollTop <= 2) {
      isAtTopRef.current = true;
      startY.current = e.touches[0].clientY; // reset start from current position
      setTouchAction('none');
    }
    
    if (scrollTop > 5) {
      isAtTopRef.current = false;
      if (isPullingRef.current) {
        isPullingRef.current = false;
        setIsPulling(false);
        setPullDistance(0);
      }
      // Restore normal touch-action when not at top
      setTouchAction('pan-y');
      return;
    }
    
    if (!isAtTopRef.current) return;
    
    currentY.current = e.touches[0].clientY;
    const distance = currentY.current - startY.current;
    
    // Prevent default as soon as we detect downward gesture from top.
    // On native WebViews, this must happen IMMEDIATELY or the browser
    // claims the gesture for native overscroll.
    if (distance > 0 && e.cancelable) {
      e.preventDefault();
    }

    if (distance > 30) {
      isPullingRef.current = true;
      setIsPulling(true);
      const resistedDistance = Math.min((distance - 30) * 0.4, threshold * 1.2);
      setPullDistance(resistedDistance);
    } else if (isPullingRef.current) {
      isPullingRef.current = false;
      setIsPulling(false);
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, threshold, getScrollTop, setTouchAction]);

  const handleTouchEnd = useCallback(async () => {
    if (disabled) return;
    
    touchActiveRef.current = false;
    
    // Restore touch-action
    setTouchAction('pan-y');
    
    if (isPullingRef.current && pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        setIsRefreshing(false);
      }
    }
    
    isPullingRef.current = false;
    setIsPulling(false);
    setPullDistance(0);
    isAtTopRef.current = false;
  }, [pullDistance, threshold, isRefreshing, onRefresh, disabled, setTouchAction]);

  useEffect(() => {
    const container = containerRef.current;
    const scrollEl = getScrollElement();
    
    const target = scrollEl && scrollEl !== container ? scrollEl : container;
    if (!target) return;

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd);

    if (container && container !== target) {
      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      
      if (container && container !== target) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
      }
      
      // Ensure touch-action is restored on cleanup
      if (target) (target as HTMLElement).style.touchAction = '';
      if (container) container.style.touchAction = '';
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, getScrollElement]);

  const pullProgress = Math.min(pullDistance / threshold, 1);

  return {
    containerRef,
    isPulling,
    isRefreshing,
    pullDistance,
    pullProgress,
  };
}
