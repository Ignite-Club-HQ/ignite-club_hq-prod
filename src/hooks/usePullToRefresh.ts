import { useState, useRef, RefObject } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
  scrollableRef?: RefObject<HTMLDivElement>;
}

export function usePullToRefresh({
  onRefresh: _onRefresh,
  threshold = 100,
  disabled: _disabled = false,
  scrollableRef: _scrollableRef,
}: UsePullToRefreshOptions) {
  // Pull-to-refresh is globally disabled due to scroll interference on native iOS/Android
  // Return stable no-op values — no event listeners, no touch-action manipulation
  const containerRef = useRef<HTMLDivElement>(null);

  return {
    containerRef,
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
    pullProgress: 0,
  };
}
