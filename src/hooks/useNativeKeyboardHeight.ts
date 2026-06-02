import { useLayoutEffect, useRef, useState } from "react";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Best-known full-viewport height for the current Android session. Captured
 * once at module load (before any push-launch navigation can race the
 * WebView's first layout) and continuously widened whenever the keyboard is
 * closed. Using a module-level ref means a chat page mounted via push deep
 * link inherits a sane baseline immediately — without it, the first
 * `syncInset()` would bake in a transitional WebView height, then later
 * under-report the keyboard inset, causing the bottom messages to slide
 * UNDER the composer/keyboard on cold-launch from a notification.
 */
let androidBaselineHeight = 0;
if (isNativeAndroid && typeof window !== "undefined") {
  const w = window as Window & { screen?: Screen };
  androidBaselineHeight = Math.max(
    androidBaselineHeight,
    w.visualViewport?.height ?? 0,
    w.innerHeight ?? 0,
    document?.documentElement?.clientHeight ?? 0,
    w.screen?.height ?? 0,
  );
}

/**
 * Returns the current soft-keyboard height (in CSS px) on native platforms.
 * iOS uses the raw native keyboard height.
 * Android compensates for WebViews that already shrink the visible viewport,
 * so chat layouts don't apply the keyboard offset twice.
 * On web this always returns 0.
 */
export function useNativeKeyboardHeight(): number {
  const iosState = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  const [androidInset, setAndroidInset] = useState(0);
  const lastBaselineRef = useRef(androidBaselineHeight);

  useLayoutEffect(() => {
    if (!isNativeAndroid || typeof window === "undefined") return;

    const visualViewport = window.visualViewport;

    const getViewportHeight = () =>
      visualViewport?.height ?? window.innerHeight ?? 0;

    const widenBaseline = (viewportHeight: number) => {
      const next = Math.max(
        androidBaselineHeight,
        viewportHeight,
        window.innerHeight ?? 0,
        document?.documentElement?.clientHeight ?? 0,
      );
      if (next > androidBaselineHeight) androidBaselineHeight = next;
      lastBaselineRef.current = androidBaselineHeight;
    };

    const syncInset = () => {
      const viewportHeight = getViewportHeight();
      if (viewportHeight <= 0) return;

      if (androidHeight <= 0) {
        // Keyboard closed — this is the only safe moment to grow the baseline.
        widenBaseline(viewportHeight);
        setAndroidInset(0);
        return;
      }

      // Keyboard open — never widen here, only consume.
      if (androidBaselineHeight <= 0) {
        androidBaselineHeight = viewportHeight;
        lastBaselineRef.current = androidBaselineHeight;
      }

      const viewportShrink = Math.max(0, androidBaselineHeight - viewportHeight);
      const nextInset = Math.max(0, androidHeight - viewportShrink);
      setAndroidInset((current) => (current === nextInset ? current : nextInset));
    };

    syncInset();
    visualViewport?.addEventListener("resize", syncInset);
    window.addEventListener("resize", syncInset);

    return () => {
      visualViewport?.removeEventListener("resize", syncInset);
      window.removeEventListener("resize", syncInset);
    };
  }, [androidHeight]);

  if (isNativeAndroid) return androidInset;
  return iosState.keyboardHeight;
}


