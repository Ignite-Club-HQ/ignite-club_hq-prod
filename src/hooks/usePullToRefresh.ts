import { useState, useRef, useCallback, useEffect, RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number; // Distance in pixels to trigger refresh
  disabled?: boolean;
  scrollableRef?: RefObject<HTMLDivElement>; // Optional ref to the actual scrollable element
}

export function usePullToRefresh({
  onRefresh,
  threshold = 100, // Increased threshold to require more intentional pull
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
  const initialScrollTopRef = useRef(0);

  const getScrollTop = useCallback(() => {
    if (scrollableRef?.current) {
      // For ScrollArea, find the viewport element
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      return viewport?.scrollTop ?? scrollableRef.current.scrollTop ?? 0;
    } else {
      const container = containerRef.current;
      return container?.scrollTop ?? 0;
    }
  }, [scrollableRef]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    const scrollTop = getScrollTop();
    initialScrollTopRef.current = scrollTop;
    
    // Only allow pull-to-refresh if scrolled to the very top (within 5px tolerance)
    isAtTopRef.current = scrollTop <= 5;
    
    if (!isAtTopRef.current) return;
    
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
  }, [disabled, isRefreshing, getScrollTop]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Re-check scroll position - user might have scrolled since touch start
    const scrollTop = getScrollTop();
    
    // If not at top anymore, reset and allow normal scrolling
    if (scrollTop > 5) {
      isAtTopRef.current = false;
      setIsPulling(false);
      setPullDistance(0);
      return;
    }
    
    if (!isAtTopRef.current) return;
    
    currentY.current = e.touches[0].clientY;
    const distance = currentY.current - startY.current;
    
    // Only trigger pull-to-refresh for significant downward pulls (> 30px)
    // This prevents accidental triggers during normal scroll attempts
    if (distance > 30) {
      // Now we're definitely pulling down - prevent default scroll only if we can
      if (e.cancelable) {
        e.preventDefault();
      }
      setIsPulling(true);
      
      // Apply strong resistance as user pulls further
      const resistedDistance = Math.min((distance - 30) * 0.4, threshold * 1.2);
      setPullDistance(resistedDistance);
    } else {
      // Not a significant pull - allow normal behavior
      setIsPulling(false);
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, threshold, getScrollTop]);

  const handleTouchEnd = useCallback(async () => {
    if (disabled) return;
    
    if (isPulling && pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        setIsRefreshing(false);
      }
    }
    
    setIsPulling(false);
    setPullDistance(0);
    isAtTopRef.current = false;
  }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh, disabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const pullProgress = Math.min(pullDistance / threshold, 1);

  return {
    containerRef,
    isPulling,
    isRefreshing,
    pullDistance,
    pullProgress,
  };
}
