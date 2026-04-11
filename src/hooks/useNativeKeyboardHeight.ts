import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the current soft-keyboard height (in CSS px) on native platforms.
 * Both iOS and Android use Capacitor Keyboard plugin events since the
 * Capacitor config sets `Keyboard.resize: 'none'` (viewport doesn't shrink).
 * On web this always returns 0.
 */
export function useNativeKeyboardHeight(): number {
  const iosState = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  if (isNativeAndroid) return androidHeight;
  return iosState.keyboardHeight;
}

