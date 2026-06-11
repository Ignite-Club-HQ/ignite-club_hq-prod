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
      // When the user focuses the composer (to reply), use a generous
      // threshold so the latest message stays visible above the keyboard
      // even if the viewport just shrank from the IME opening.
      if (isNearBottom(scrollContainerRef.current, 400)) {
        snapToBottom();
        // Re-snap across the keyboard animation window so the last message
        // remains pinned above the composer once the IME has fully opened.
        [120, 280, 480].forEach((delay) => {
          setTimeout(() => {
            const vp = resolveChatScrollViewport(scrollContainerRef.current);
            if (vp && isViewportUserActive(vp)) return;
            if (isNearBottom(scrollContainerRef.current, 400)) {
              snapToBottom();
            }
          }, delay);
        });
      }
    };

    let resizeRaf = 0;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    const handleViewportResize = () => {
      if (!isComposerTarget(document.activeElement)) return;
      // Android fires a long sequence of resize events while the keyboard
      // animates. Debounce to the trailing edge so we snap once after the
      // keyboard has settled — not on every intermediate frame, which
      // produces the "stair-step" jolt during keyboard open/close.
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        resizeDebounce = null;
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          const vp = resolveChatScrollViewport(scrollContainerRef.current);
          if (vp && isViewportUserActive(vp)) return;
          resetViewportScroll();
          // Use a generous threshold during keyboard animation so the
          // shrinking viewport (which artificially increases distance-to-
          // bottom) doesn't prevent the snap that keeps the last message
          // visible above the composer.
          if (isNearBottom(scrollContainerRef.current, 400)) {
            snapToBottom();
          }
        });
      }, 60);
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
      if (resizeDebounce) clearTimeout(resizeDebounce);
      disposeKeyboardScrollLock?.();
    };
  }, [enabled, scrollContainerRef]);
}

