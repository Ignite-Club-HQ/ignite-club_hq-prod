import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface UseVisibilityRefreshOptions {
  /**
   * Query keys to invalidate when the app becomes visible
   */
  queryKeys?: string[][];
  /**
   * Custom callback to run when visibility changes to visible
   */
  onVisible?: () => void;
  /**
   * Minimum time in ms between visibility refreshes (default: 30000 = 30s)
   * This prevents excessive refreshes if user rapidly switches tabs
   */
  minInterval?: number;
  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean;
}

/**
 * Hook to handle app visibility changes (e.g., phone lock/unlock, tab switch)
 * Triggers query invalidation and optional callbacks when the app becomes visible
 */
export function useVisibilityRefresh({
  queryKeys = [],
  onVisible,
  minInterval = 30000,
  enabled = true,
}: UseVisibilityRefreshOptions = {}) {
  const queryClient = useQueryClient();
  const lastRefreshRef = useRef<number>(0);
  const wasHiddenRef = useRef(false);

  const handleVisibilityChange = useCallback(() => {
    if (!enabled) return;

    if (document.visibilityState === "hidden") {
      wasHiddenRef.current = true;
      return;
    }

    // Only refresh if we were actually hidden (not just initial load)
    if (document.visibilityState === "visible" && wasHiddenRef.current) {
      const now = Date.now();
      const timeSinceLastRefresh = now - lastRefreshRef.current;

      // Throttle refreshes to avoid excessive requests
      if (timeSinceLastRefresh >= minInterval) {
        lastRefreshRef.current = now;

        // Invalidate specified query keys
        queryKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });

        // Run custom callback
        onVisible?.();
      }
    }
  }, [enabled, queryKeys, onVisible, minInterval, queryClient]);

  useEffect(() => {
    if (!enabled) return;

    // Check initial state
    if (document.visibilityState === "visible") {
      lastRefreshRef.current = Date.now();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also handle page show event (helps with Safari PWA)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page was restored from bfcache
        handleVisibilityChange();
      }
    };
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [enabled, handleVisibilityChange]);
}
