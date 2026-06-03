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
        // The Capacitor Keyboard plugin on Android may report keyboard height
        // in either raw device pixels (older versions / some OEMs) or CSS
        // pixels (newer versions). Detect which one by comparing against the
        // layout viewport: a real keyboard never exceeds ~60% of the layout
        // viewport height in CSS px, so anything larger than that almost
        // certainly came in as device px and must be divided by DPR.
        const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
        const layoutH = typeof window !== "undefined" ? window.innerHeight : 0;
        const raw = h || 0;
        // Heuristic: if the reported value is more than 60% of the layout
        // viewport, it's almost certainly in device pixels — convert it.
        const looksLikeDevicePx = layoutH > 0 && raw > layoutH * 0.6;
        const finalHeight = looksLikeDevicePx ? raw / dpr : raw;
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

    // Safety net: Capacitor's keyboardDidHide can be missed on Android when
    // the user navigates away (system back, in-app nav) before the keyboard
    // finishes its hide animation — leaving the cached height > 0 forever
    // and the BottomNav permanently translated off-screen. If focus leaves
    // every editable element and nothing else picks it up shortly after,
    // force-reset to 0.
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return (el as HTMLElement).isContentEditable === true;
    };

    let focusoutTimer = 0;
    const handleFocusOut = () => {
      window.clearTimeout(focusoutTimer);
      focusoutTimer = window.setTimeout(() => {
        if (!isEditable(document.activeElement)) applyHeight(0);
      }, 250);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isEditable(document.activeElement)) {
        applyHeight(0);
      }
    };

    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      keyboardWillShowHandle?.remove();
      keyboardDidShowHandle?.remove();
      keyboardWillHideHandle?.remove();
      keyboardDidHideHandle?.remove();
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(focusoutTimer);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return isNativeAndroid ? keyboardHeight : 0;
}
