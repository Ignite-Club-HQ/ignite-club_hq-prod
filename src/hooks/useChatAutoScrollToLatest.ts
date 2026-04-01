import { RefObject, useEffect } from "react";

interface UseChatAutoScrollToLatestOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  enabled?: boolean;
}

/**
 * Keeps latest messages visible when the composer is engaged.
 * - On input focus: always jump to latest
 * - On viewport resize (keyboard show/hide): jump only while an input is focused
 */
export function useChatAutoScrollToLatest({
  scrollContainerRef,
  enabled = true,
}: UseChatAutoScrollToLatestOptions) {
  useEffect(() => {
    if (!enabled) return;

    const scrollToLatest = () => {
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    };

    const isComposerTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element?.closest("input, textarea, [contenteditable='true']");
    };

    const isComposerFocused = () => isComposerTarget(document.activeElement);

    const handleFocusIn = (event: FocusEvent) => {
      if (!isComposerTarget(event.target)) return;
      scrollToLatest();
    };

    const handleViewportResize = () => {
      if (!isComposerFocused()) return;
      scrollToLatest();
    };

    window.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [enabled, scrollContainerRef]);
}
