import { RefObject, useEffect } from "react";
import { scrollChatToBottom } from "@/lib/chatScroll";

interface UseChatAutoScrollToLatestOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  enabled?: boolean;
}

/**
 * Keeps the chat pinned to bottom when:
 * - The composer receives focus (keyboard opens)
 * - The viewport resizes while the composer is focused (keyboard animation)
 *
 * This is the SINGLE source of truth for keyboard-related scroll adjustments.
 * Individual chat pages should NOT add their own keyboard scroll effects.
 */
export function useChatAutoScrollToLatest({
  scrollContainerRef,
  enabled = true,
}: UseChatAutoScrollToLatestOptions) {
  useEffect(() => {
    if (!enabled) return;

    const isComposerTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element?.closest("input, textarea, [contenteditable='true']");
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isComposerTarget(event.target)) return;
      scrollChatToBottom(scrollContainerRef.current);
    };

    const handleViewportResize = () => {
      if (!isComposerTarget(document.activeElement)) return;
      scrollChatToBottom(scrollContainerRef.current);
    };

    window.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [enabled, scrollContainerRef]);
}
