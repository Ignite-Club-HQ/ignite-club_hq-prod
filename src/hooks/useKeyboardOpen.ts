import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

const KEYBOARD_OPEN_THRESHOLD = 100;
const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!element?.closest(
    "textarea, input:not([type='button']):not([type='checkbox']):not([type='file']):not([type='hidden']):not([type='radio']):not([type='reset']):not([type='submit']), [contenteditable='true']",
  );
};

/**
 * Detects soft keyboard visibility using native keyboard events when available,
 * otherwise falls back to visualViewport height changes.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const { isKeyboardOpen: iosOpen, keyboardHeight: iosHeight } = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [isEditableFocused, setIsEditableFocused] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const syncFocusedEditable = () => {
      setIsEditableFocused(isEditableTarget(document.activeElement));
    };

    const handleFocusIn = (event: FocusEvent) => {
      setIsEditableFocused(isEditableTarget(event.target) || isEditableTarget(document.activeElement));
    };

    const handleFocusOut = () => {
      requestAnimationFrame(syncFocusedEditable);
    };

    syncFocusedEditable();
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.addEventListener("blur", syncFocusedEditable);
    document.addEventListener("visibilitychange", syncFocusedEditable);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("blur", syncFocusedEditable);
      document.removeEventListener("visibilitychange", syncFocusedEditable);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

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

  if (isNativeIOS) return iosOpen || iosHeight > threshold || fallbackOpen || isEditableFocused;
  if (isNativeAndroid) return androidHeight > threshold || fallbackOpen || isEditableFocused;
  return fallbackOpen || isEditableFocused;
}

