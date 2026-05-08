import { RefObject, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { isNearBottom, resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";
import { isViewportUserActive } from "@/lib/chatScrollIntent";

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

    // Only reset the outer document scroll if it has actually drifted from 0.
    // Calling window.scrollTo unconditionally on every focusin / viewport
    // resize causes visible jolts inside the chat scroll container on Android
    // because the browser re-runs scroll-anchoring logic on the inner viewport.
    const resetViewportScroll = () => {
      if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
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
      // Reset outer window scroll only if it has drifted (header would hide).
      resetViewportScroll();
      requestAnimationFrame(resetViewportScroll);
      // Only auto-scroll the chat container to bottom if the user was
      // already near the bottom; otherwise preserve their scroll position
      // and DO NOT schedule extra delayed resets — those caused mid-scroll jolts.
      if (isNearBottom(scrollContainerRef.current)) {
        snapToBottom();
      }
    };

    let resizeRaf = 0;
    const handleViewportResize = () => {
      if (!isComposerTarget(document.activeElement)) return;
      // Coalesce the rapid Android keyboard-animation resize events into a
      // single rAF tick so we snap at most once per frame.
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const vp = resolveChatScrollViewport(scrollContainerRef.current);
        if (vp && isViewportUserActive(vp)) return;
        resetViewportScroll();
        if (isNearBottom(scrollContainerRef.current)) {
          snapToBottom();
        }
      });
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
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      disposeKeyboardScrollLock?.();
    };
  }, [enabled, scrollContainerRef]);
}

