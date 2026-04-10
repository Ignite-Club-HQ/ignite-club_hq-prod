import { Capacitor } from "@capacitor/core";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";

const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the chat shell height.
 *
 * - Web: rely on 100dvh
 * - Native Android: rely on 100vh + adjustResize
 * - Native iOS: use stable viewport height minus native keyboard height
 */
export function useChatViewportHeight(headerOffset = "4rem") {
  const nativeKeyboardHeight = useNativeKeyboardHeight();

  if (!isNative) {
    return `calc(100dvh - ${headerOffset})`;
  }

  if (isNativeAndroid) {
    return `calc(100vh - ${headerOffset})`;
  }

  if (isNativeIOS) {
    return `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px - ${headerOffset})`;
  }

  return `calc(var(--stable-vh, 100vh) - ${headerOffset})`;
}
