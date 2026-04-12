import { Capacitor } from "@capacitor/core";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";

const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the chat shell height.
 *
 * Subtracts headerOffset (top) and bottomNavOffset (bottom nav) from the
 * viewport. On native platforms, the bottom nav is hidden when the keyboard
 * is open, so the offset is only applied when the keyboard is closed.
 *
 * - Web: rely on 100dvh
 * - Native Android: use stable viewport height minus native keyboard height
 *   (Capacitor Keyboard.resize is set to 'none' so 100vh does NOT shrink)
 * - Native iOS: use stable viewport height minus native keyboard height
 */
export function useChatViewportHeight(headerOffset = "4rem") {
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const isKeyboardOpen = useKeyboardOpen();

  // When keyboard is open on native, bottom nav is covered by keyboard,
  // so we don't need to subtract it. On web or when keyboard is closed,
  // subtract the bottom nav offset.
  const bottomNavOffset = isNative
    ? (isKeyboardOpen ? "0px" : "var(--bottom-nav-offset, 4rem)")
    : "var(--bottom-nav-offset, 4rem)";

  if (!isNative) {
    return `calc(100dvh - ${headerOffset} - ${bottomNavOffset})`;
  }

  if (isNativeAndroid) {
    if (nativeKeyboardHeight > 0) {
      return `calc(100vh - ${nativeKeyboardHeight}px - ${headerOffset})`;
    }
    return `calc(100vh - ${headerOffset} - ${bottomNavOffset})`;
  }

  if (isNativeIOS) {
    if (nativeKeyboardHeight > 0) {
      return `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px - ${headerOffset})`;
    }
    return `calc(var(--stable-vh, 100dvh) - ${headerOffset} - ${bottomNavOffset})`;
  }

  return `calc(var(--stable-vh, 100vh) - ${headerOffset} - ${bottomNavOffset})`;
}
