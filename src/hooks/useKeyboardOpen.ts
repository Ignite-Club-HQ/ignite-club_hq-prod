import { useMemo } from "react";
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

  return useMemo(() => {
    if (isNativeIOS) {
      return isKeyboardOpen || keyboardHeight > threshold;
    }

    const vv = window.visualViewport;
    if (!vv) return false;

    let baselineHeight = vv.height;
    if (vv.height > baselineHeight) {
      baselineHeight = vv.height;
    }

    return baselineHeight - vv.height > threshold;
  }, [isNativeIOS, isKeyboardOpen, keyboardHeight, threshold]);
}

