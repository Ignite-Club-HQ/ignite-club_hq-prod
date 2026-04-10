import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";

const KEYBOARD_OPEN_THRESHOLD = 100;

/**
 * Detects soft keyboard visibility using native iOS keyboard events when available,
 * otherwise falls back to visualViewport height changes.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const { isKeyboardOpen, keyboardHeight } = useNativeIOSKeyboardState();
  const [fallbackOpen, setFallbackOpen] = useState(false);

  useEffect(() => {
    if (isNativeIOS) return;

    const vv = window.visualViewport;
    if (!vv) return;

    let baselineHeight = vv.height;

    const update = () => {
      if (vv.height > baselineHeight) {
        baselineHeight = vv.height;
      }
      setFallbackOpen(baselineHeight - vv.height > threshold);
    };

    update();
    vv.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
    };
  }, [isNativeIOS, threshold]);

  return isNativeIOS ? (isKeyboardOpen || keyboardHeight > threshold) : fallbackOpen;
}

