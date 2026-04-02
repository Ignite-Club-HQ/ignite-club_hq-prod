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
  const hasPinnedRef = useRef(false);
  const onPinnedRef = useRef(onPinned);
  const [isPinned, setIsPinned] = useState(true);

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  // Reset pin state when the chat thread changes
  useEffect(() => {
    hasPinnedRef.current = false;
    setIsPinned(true);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled || itemCount <= 0) return;

    // If already pinned for this thread, skip
    if (hasPinnedRef.current) return;

    // Hide while positioning
    setIsPinned(false);

    // Immediate snap attempt
    scrollChatToBottom(scrollContainerRef.current);

    // Double-rAF ensures the DOM is fully laid out with message content
    let raf1 = 0;
    let raf2 = 0;
    let safetyTimeout = 0;
    let didFinalize = false;

    const finalize = () => {
      if (didFinalize) return;
      didFinalize = true;
      hasPinnedRef.current = true;
      scrollChatToBottom(scrollContainerRef.current);
      setIsPinned(true);
      onPinnedRef.current?.();
    };

    raf1 = requestAnimationFrame(() => {
      scrollChatToBottom(scrollContainerRef.current);
      raf2 = requestAnimationFrame(() => {
        finalize();
      });
    });

    // Safety: always reveal after 300ms even if rAF is delayed
    safetyTimeout = window.setTimeout(finalize, 300);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(safetyTimeout);
      if (!didFinalize) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  return { isPinned };
}
