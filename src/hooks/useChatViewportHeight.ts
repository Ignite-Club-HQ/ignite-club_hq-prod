import { Capacitor } from "@capacitor/core";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";

const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the chat shell height.
 *
 * - Web: rely on 100dvh
 * - Native Android: use stable viewport height minus native keyboard height
 *   (Capacitor Keyboard.resize is set to 'none' so 100vh does NOT shrink)
 * - Native iOS: use stable viewport height minus native keyboard height
 */
export function useChatViewportHeight(headerOffset = "4rem") {
  const nativeKeyboardHeight = useNativeKeyboardHeight();

  if (!isNative) {
    return `calc(100dvh - ${headerOffset})`;
  }

  if (isNativeAndroid) {
    // With Keyboard.resize:'none', 100vh stays full-screen even when
    // keyboard is open.  Subtract the keyboard height manually.
    if (nativeKeyboardHeight > 0) {
      return `calc(100vh - ${nativeKeyboardHeight}px - ${headerOffset})`;
    }
    return `calc(100vh - ${headerOffset})`;
  }

  if (isNativeIOS) {
    return `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px - ${headerOffset})`;
  }

  return `calc(var(--stable-vh, 100vh) - ${headerOffset})`;
}
