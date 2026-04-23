import { useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const isNativeAndroid =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/**
 * Returns the current soft-keyboard height (in CSS px) on native Android.
 *
 * Since the Capacitor config uses `Keyboard.resize: 'none'`, the WebView
 * viewport does NOT shrink when the keyboard opens. We rely on Capacitor
 * keyboard plugin events to get the keyboard height and manually offset
 * chat layouts.
 */
export function useNativeAndroidKeyboardState(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!isNativeAndroid) return;

    let keyboardWillShowHandle: { remove: () => void } | undefined;
    let keyboardDidShowHandle: { remove: () => void } | undefined;
    let keyboardWillHideHandle: { remove: () => void } | undefined;
    let keyboardDidHideHandle: { remove: () => void } | undefined;

    const applyHeight = (nextHeight: number) => {
      const rounded = Math.max(0, Math.round(nextHeight));
      setKeyboardHeight((current) => (current === rounded ? current : rounded));
    };

    const handleShow = ({ keyboardHeight: h }: { keyboardHeight: number }) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // Capacitor Keyboard plugin on Android reports height in raw device
        // pixels. Convert to CSS pixels so it can be compared against
        // window.innerHeight (which is in CSS pixels). On iOS the plugin
        // already returns CSS pixels, but this hook is Android-only.
        const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
        const cssHeight = (h || 0) / dpr;
        // Sanity guard: if the value already looks like CSS px (smaller than
        // the layout viewport), don't divide again. This handles future
        // plugin versions that may switch to CSS px.
        const layoutH = typeof window !== "undefined" ? window.innerHeight : 0;
        const finalHeight = h > layoutH ? cssHeight : (h || 0);
        applyHeight(Math.max(0, finalHeight));
      });
    };

    const handleHide = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyHeight(0);
      });
    };

    Keyboard.addListener("keyboardWillShow", handleShow)
      .then((handle) => { keyboardWillShowHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardDidShow", handleShow)
      .then((handle) => { keyboardDidShowHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardWillHide", handleHide)
      .then((handle) => { keyboardWillHideHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardDidHide", handleHide)
      .then((handle) => { keyboardDidHideHandle = handle; })
      .catch(() => {});

    return () => {
      keyboardWillShowHandle?.remove();
      keyboardDidShowHandle?.remove();
      keyboardWillHideHandle?.remove();
      keyboardDidHideHandle?.remove();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return isNativeAndroid ? keyboardHeight : 0;
}
