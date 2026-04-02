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
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  useLayoutEffect(() => {
    // Already pinned for this key — nothing to do
    if (pinnedKeyRef.current === resetKey) return;

    if (!enabled || itemCount <= 0) {
      // No messages or disabled — show content, no scroll needed
      setIsPinned(true);
      return;
    }

    setIsPinned(false);

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    const STABILITY_MS = 80;
    const MAX_WAIT_MS = 1200;

    const finalize = () => {
      if (cancelled) return;
      cancelled = true;
      observer?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);

      scrollChatToBottom(scrollContainerRef.current);

      requestAnimationFrame(() => {
        scrollChatToBottom(scrollContainerRef.current);
        pinnedKeyRef.current = resetKey;
        setIsPinned(true);
        onPinnedRef.current?.();
      });
    };

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) {
      setIsPinned(true);
      pinnedKeyRef.current = resetKey;
      onPinnedRef.current?.();
      return;
    }

    if (viewport.scrollHeight > viewport.clientHeight + 10) {
      finalize();
      return;
    }

    const scheduleFinalize = () => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(finalize, STABILITY_MS);
    };

    observer = new MutationObserver(() => {
      if (cancelled) return;
      const vp = resolveChatScrollViewport(scrollContainerRef.current);
      if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
      scheduleFinalize();
    });

    observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    scheduleFinalize();

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

  // On native: re-snap on app resume
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
