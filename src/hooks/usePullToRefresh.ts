import { useState, useRef, useCallback, useEffect, RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number; // Distance in pixels to trigger refresh
  disabled?: boolean;
  scrollableRef?: RefObject<HTMLDivElement>; // Optional ref to the actual scrollable element
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  disabled = false,
  scrollableRef,
}: UsePullToRefreshOptions) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  
  const startY = useRef(0);
  const currentY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Find the scrollable element - either the provided scrollableRef's viewport or the container
    let scrollTop = 0;
    
    if (scrollableRef?.current) {
      // For ScrollArea, find the viewport element
      const viewport = scrollableRef.current.querySelector('[data-radix-scroll-area-viewport]');
      scrollTop = viewport?.scrollTop ?? scrollableRef.current.scrollTop ?? 0;
    } else {
      const container = containerRef.current;
      if (!container) return;
      scrollTop = container.scrollTop;
    }
    
    // Only trigger if scrolled to very top (increase threshold to prevent accidental triggers)
    if (scrollTop > 10) return;
    
    startY.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [disabled, isRefreshing, scrollableRef]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling || disabled || isRefreshing) return;
    
    currentY.current = e.touches[0].clientY;
    const distance = Math.max(0, currentY.current - startY.current);
    
    // Only prevent default and show pull indicator if pulling down significantly
    // This allows normal scrolling to work
    if (distance > 20) {
      e.preventDefault();
      // Apply resistance as user pulls further
      const resistedDistance = Math.min((distance - 20) * 0.5, threshold * 1.5);
      setPullDistance(resistedDistance);
    } else {
      // Reset if not pulling enough - allow normal scroll
      setPullDistance(0);
    }
  }, [isPulling, disabled, isRefreshing, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || disabled) return;
    
    if (pullDistance >= threshold && !isRefreshing) {
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
