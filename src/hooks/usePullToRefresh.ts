import { useState, useRef, useCallback, useEffect, RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
  scrollableRef?: RefObject<HTMLDivElement>;
}

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

  const getScrollTop = useCallback(() => {
    if (scrollableRef?.current) {
      // Check for Radix scroll area viewport first, then use the element directly
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport.scrollTop ?? 0;
      return scrollableRef.current.scrollTop ?? 0;
    }
    const container = containerRef.current;
    return container?.scrollTop ?? 0;
  }, [scrollableRef]);

  // Get the element that actually scrolls (for attaching touch listeners)
  const getScrollElement = useCallback((): HTMLElement | null => {
    if (scrollableRef?.current) {
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) return viewport as HTMLElement;
      // Return the scrollableRef directly — it IS the scrolling element
      return scrollableRef.current;
    }
    return containerRef.current;
  }, [scrollableRef]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    const scrollTop = getScrollTop();
    isAtTopRef.current = scrollTop <= 5;
    
    if (!isAtTopRef.current) return;
    
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    isPullingRef.current = false;
  }, [disabled, isRefreshing, getScrollTop]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    const scrollTop = getScrollTop();
    
    if (scrollTop > 5) {
      isAtTopRef.current = false;
      if (isPullingRef.current) {
        isPullingRef.current = false;
        setIsPulling(false);
        setPullDistance(0);
      }
      return;
    }
    
    if (!isAtTopRef.current) return;
    
    currentY.current = e.touches[0].clientY;
    const distance = currentY.current - startY.current;
    
    // On Android WebView, we must preventDefault() as soon as we detect a
    // downward gesture from the top — even during the deadzone. If we wait,
    // the browser claims the gesture for native scrolling/overscroll and
    // subsequent preventDefault() calls are ignored.
    if (distance > 5 && e.cancelable) {
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
  }, [disabled, isRefreshing, threshold, getScrollTop]);

  const handleTouchEnd = useCallback(async () => {
    if (disabled) return;
    
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
  }, [pullDistance, threshold, isRefreshing, onRefresh, disabled]);

  useEffect(() => {
    // Attach to BOTH the container and the scrollable element
    // This ensures we capture touch events on Android where the scrollable
    // child may consume them before they reach the parent container
    const container = containerRef.current;
    const scrollEl = getScrollElement();
    
    // Use the scrollable element if available, otherwise fall back to container
    const target = scrollEl && scrollEl !== container ? scrollEl : container;
    if (!target) return;

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd);

    // Also attach to container if different from target (for cases where
    // touch starts outside the scroll area)
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
