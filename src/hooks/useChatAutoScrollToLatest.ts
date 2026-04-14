import { RefObject, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { isNearBottom, scrollChatToBottom } from "@/lib/chatScroll";

interface UseChatAutoScrollToLatestOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  enabled?: boolean;
}

const isNativeIOS =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

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

    const resetViewportScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    const isComposerTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element?.closest("input, textarea, [contenteditable='true']");
    };

    const snapToBottom = () => {
      resetViewportScroll();
      scrollChatToBottom(scrollContainerRef.current);
      requestAnimationFrame(() => {
        resetViewportScroll();
        scrollChatToBottom(scrollContainerRef.current);
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isComposerTarget(event.target)) return;
      // Always reset the outer window scroll — the document should never
      // scroll in a chat page or the header disappears on Android.
      resetViewportScroll();
      requestAnimationFrame(resetViewportScroll);
      // Only auto-scroll the chat container to bottom if the user was
      // already near the bottom; otherwise preserve their scroll position.
      if (isNearBottom(scrollContainerRef.current)) {
        snapToBottom();
        setTimeout(snapToBottom, 80);
      } else {
        // Extra resets to counteract Android's delayed document scroll
        setTimeout(resetViewportScroll, 80);
        setTimeout(resetViewportScroll, 300);
      }
    };

    const handleViewportResize = () => {
      if (!isComposerTarget(document.activeElement)) return;
      // Always keep the outer window pinned to top
      resetViewportScroll();
      if (isNearBottom(scrollContainerRef.current)) {
        snapToBottom();
      }
    };

    let disposeKeyboardScrollLock: (() => void) | undefined;
    if (isNativeIOS) {
      Keyboard.setScroll({ isDisabled: true }).catch(() => {
        // Ignore unsupported environments
      });
      disposeKeyboardScrollLock = () => {
        Keyboard.setScroll({ isDisabled: false }).catch(() => {
          // Ignore unsupported environments
        });
      };
    }

    window.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      disposeKeyboardScrollLock?.();
    };
  }, [enabled, scrollContainerRef]);
}

