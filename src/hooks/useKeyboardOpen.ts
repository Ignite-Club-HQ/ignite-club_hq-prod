import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

const KEYBOARD_OPEN_THRESHOLD = 100;
const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Detects soft keyboard visibility using native keyboard events when available,
 * otherwise falls back to visualViewport height changes.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const { isKeyboardOpen: iosOpen, keyboardHeight: iosHeight } = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  const [fallbackOpen, setFallbackOpen] = useState(false);

  useEffect(() => {
    if (isNativeIOS || isNativeAndroid) return;

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
  }, [threshold]);

  if (isNativeIOS) return iosOpen || iosHeight > threshold;
  if (isNativeAndroid) return androidHeight > threshold;
  return fallbackOpen;
}

