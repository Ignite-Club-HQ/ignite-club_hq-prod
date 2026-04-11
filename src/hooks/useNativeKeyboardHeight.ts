import { useLayoutEffect, useRef, useState } from "react";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

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
  const androidBaselineRef = useRef(0);

  useLayoutEffect(() => {
    if (!isNativeAndroid || typeof window === "undefined") return;

    const visualViewport = window.visualViewport;

    const getViewportHeight = () =>
      visualViewport?.height ?? window.innerHeight ?? 0;

    const syncInset = () => {
      const viewportHeight = getViewportHeight();
      if (viewportHeight <= 0) return;

      if (androidHeight <= 0) {
        androidBaselineRef.current = Math.max(androidBaselineRef.current, viewportHeight);
        setAndroidInset(0);
        return;
      }

      if (androidBaselineRef.current <= 0) {
        androidBaselineRef.current = viewportHeight;
      }

      const viewportShrink = Math.max(0, androidBaselineRef.current - viewportHeight);
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

