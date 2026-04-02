import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

import { resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";

interface UseInitialChatBottomPinOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  bottomAnchorRef?: RefObject<HTMLElement>;
  itemCount: number;
  resetKey?: string | number | null;
  enabled?: boolean;
  onPinned?: () => void;
}

/**
 * Pins a chat scroll container to the bottom on initial load.
 *
 * Strategy: wait for content to appear and layout to stabilise (quiet for 80ms),
 * then snap once and reveal. Much simpler than the previous rAF-loop approach,
 * eliminating scroll thrash during the stabilisation window.
 */
export function useInitialChatBottomPin({
  scrollContainerRef,
  bottomAnchorRef,
  itemCount,
  resetKey,
  enabled = true,
  onPinned,
}: UseInitialChatBottomPinOptions) {
  const pinnedKeyRef = useRef<string | number | null | undefined>(undefined);
  const onPinnedRef = useRef(onPinned);
  const [isPinned, setIsPinned] = useState(true);

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  // Reset when thread changes
  useEffect(() => {
    pinnedKeyRef.current = undefined;
    setIsPinned(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled || itemCount <= 0 || pinnedKeyRef.current === resetKey) return;

    setIsPinned(false);

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    const STABILITY_MS = 80; // how long layout must be quiet before we pin
    const MAX_WAIT_MS = 1200; // safety cap

    const finalize = () => {
      if (cancelled) return;
      cancelled = true;
      observer?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);

      scrollChatToBottom(scrollContainerRef.current);

      // One more rAF to confirm we're actually at bottom after the snap
      requestAnimationFrame(() => {
        scrollChatToBottom(scrollContainerRef.current);
        pinnedKeyRef.current = resetKey;
        setIsPinned(true);
        onPinnedRef.current?.();
      });
    };

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) {
      // No viewport yet — reveal immediately to avoid permanent blank
      setIsPinned(true);
      pinnedKeyRef.current = resetKey;
      onPinnedRef.current?.();
      return;
    }

    // If content is already rendered (cached), pin immediately
    if (viewport.scrollHeight > viewport.clientHeight + 10) {
      finalize();
      return;
    }

    // Otherwise watch for DOM mutations (content loading in)
    const scheduleFinalize = () => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(finalize, STABILITY_MS);
    };

    observer = new MutationObserver(() => {
      if (cancelled) return;
      // Snap while we wait so content doesn't flash at wrong position
      const vp = resolveChatScrollViewport(scrollContainerRef.current);
      if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
      scheduleFinalize();
    });

    observer.observe(viewport, { childList: true, subtree: true, characterData: true });

    // Kick off the first stability timer in case content is already there
    scheduleFinalize();

    // Safety cap
    const maxTimer = setTimeout(finalize, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      clearTimeout(maxTimer);
      if (pinnedKeyRef.current !== resetKey) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  // On native: re-snap on app resume (visibility change)
  useEffect(() => {
    if (!isPinned || !Capacitor.isNativePlatform()) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isPinned, scrollContainerRef, resetKey]);

  return { isPinned };
}
