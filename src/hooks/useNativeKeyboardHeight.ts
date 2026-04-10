import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";

/**
 * Returns the current soft-keyboard height (in CSS px) on native iOS.
 * On Android / web this always returns 0 because those environments
 * handle keyboard offset automatically (adjustResize / dvh).
 */
export function useNativeKeyboardHeight(): number {
  return useNativeIOSKeyboardState().keyboardHeight;
}

