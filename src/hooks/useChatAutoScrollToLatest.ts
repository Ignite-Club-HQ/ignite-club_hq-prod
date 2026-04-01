import { RefObject, useEffect } from "react";

interface UseChatAutoScrollToLatestOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  enabled?: boolean;
  threshold?: number;
}

/**
 * Keeps the latest message visible above the composer when the user focuses
 * an input (keyboard opens) or when visual viewport changes.
 */
export function useChatAutoScrollToLatest({
  scrollContainerRef,
  enabled = true,
  threshold = 240,
}: UseChatAutoScrollToLatestOptions) {
  useEffect(() => {
    if (!enabled) return;

    const scrollToLatest = () => {
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (!el) return;

        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const shouldStickToBottom = distanceFromBottom <= threshold;
        if (!shouldStickToBottom) return;

        el.scrollTop = el.scrollHeight;
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("input, textarea, [contenteditable='true']")) return;
      scrollToLatest();
    };

    window.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", scrollToLatest);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", scrollToLatest);
    };
  }, [enabled, scrollContainerRef, threshold]);
}
