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

  // Reset pin state when the chat thread changes
  useEffect(() => {
    pinnedKeyRef.current = undefined;
    setIsPinned(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled || itemCount <= 0 || pinnedKeyRef.current === resetKey) return;

    setIsPinned(false);

    let raf = 0;
    let cancelled = false;
    let didFinalize = false;
    let startedAt = 0;
    let stableSince = 0;
    let lastSignature = "";

    const getSignature = (viewport: HTMLElement) => {
      const anchorOffset = bottomAnchorRef?.current?.offsetTop ?? viewport.scrollHeight;
      const contentHeight = bottomAnchorRef?.current?.parentElement?.scrollHeight ?? viewport.scrollHeight;
      const childCount = bottomAnchorRef?.current?.parentElement?.childElementCount ?? 0;

      return `${viewport.scrollHeight}:${viewport.clientHeight}:${itemCount}:${anchorOffset}:${contentHeight}:${childCount}`;
    };

    const finalize = () => {
      if (cancelled || didFinalize) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      scrollChatToBottom(scrollContainerRef.current);

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const distanceFromBottom = Math.max(0, maxScrollTop - viewport.scrollTop);
      if (distanceFromBottom > 4) {
        raf = requestAnimationFrame(tick);
        return;
      }

      didFinalize = true;
      pinnedKeyRef.current = resetKey;
      setIsPinned(true);
      onPinnedRef.current?.();
    };

    const tick = (timestamp: number) => {
      if (cancelled || didFinalize) return;

      if (startedAt === 0) startedAt = timestamp;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) {
        raf = requestAnimationFrame(tick);
        return;
      }

      scrollChatToBottom(scrollContainerRef.current);

      const signature = getSignature(viewport);
      if (signature !== lastSignature) {
        lastSignature = signature;
        stableSince = timestamp;
      }

      const hasMeasuredContent = viewport.scrollHeight > 0;
      const observedFor = timestamp - startedAt;
      const quietFor = stableSince === 0 ? 0 : timestamp - stableSince;

      // First-open chats can still shift well after first paint (auth hydration, banners, composer sizing,
      // avatar/reaction hydration). Keep the thread hidden until the measured bottom stays quiet longer.
      if (hasMeasuredContent && observedFor >= 520 && quietFor >= 180) {
        finalize();
        return;
      }

      // Safety cap so we always fail open if the layout keeps changing.
      if (observedFor >= 1800) {
        finalize();
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (!didFinalize) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  // On native, the viewport height can shift after pin (Capacitor layout settling,
  // status bar changes, safe-area recalculation). Re-scroll to bottom when this happens.
  useEffect(() => {
    if (!isPinned || !Capacitor.isNativePlatform()) return;

    const vv = window.visualViewport;
    if (!vv) return;

    let lastHeight = vv.height;
    let raf = 0;

    const onResize = () => {
      const newHeight = vv.height;
      // Only re-scroll for small layout shifts (not keyboard open/close which is large)
      if (Math.abs(newHeight - lastHeight) > 0 && Math.abs(newHeight - lastHeight) < 200) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          scrollChatToBottom(scrollContainerRef.current);
        });
      }
      lastHeight = newHeight;
    };

    vv.addEventListener("resize", onResize);

    // Also do a delayed re-scroll after pin to catch any post-pin layout shifts
    const t1 = setTimeout(() => scrollChatToBottom(scrollContainerRef.current), 100);
    const t2 = setTimeout(() => scrollChatToBottom(scrollContainerRef.current), 300);
    const t3 = setTimeout(() => scrollChatToBottom(scrollContainerRef.current), 600);

    return () => {
      vv.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isPinned, scrollContainerRef, resetKey]);

  return { isPinned };
}
