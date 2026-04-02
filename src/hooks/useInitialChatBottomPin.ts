import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

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
    setIsPinned(true);
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

    const finalize = () => {
      if (cancelled || didFinalize) return;

      didFinalize = true;
      pinnedKeyRef.current = resetKey;
      scrollChatToBottom(scrollContainerRef.current);
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

      const signature = `${viewport.scrollHeight}:${viewport.clientHeight}:${itemCount}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        stableSince = timestamp;
      }

      const hasMeasuredContent = viewport.scrollHeight > 0;
      const observedFor = timestamp - startedAt;
      const quietFor = stableSince === 0 ? 0 : timestamp - stableSince;

      // First-open chats can still shift after the first paint (auth hydration, banner/composer sizing,
      // avatar/profile hydration). Keep snapping until the viewport metrics have been quiet for a short
      // period, then reveal the thread once it is actually at the bottom.
      if (hasMeasuredContent && observedFor >= 260 && quietFor >= 120) {
        finalize();
        return;
      }

      // Safety cap so we always fail open if the layout keeps changing.
      if (observedFor >= 1000) {
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

  return { isPinned };
}
