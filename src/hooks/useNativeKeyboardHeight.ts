import { useEffect, useReducer, useRef } from "react";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Best-known full-viewport height for the current Android session. Captured
 * once at module load (before any push-launch navigation can race the
 * WebView's first layout) and continuously widened whenever the keyboard is
 * closed.
 */
let androidBaselineHeight = 0;
if (isNativeAndroid && typeof window !== "undefined") {
  const w = window as Window & { screen?: Screen };
  androidBaselineHeight = Math.max(
    androidBaselineHeight,
    w.visualViewport?.height ?? 0,
    w.innerHeight ?? 0,
    document?.documentElement?.clientHeight ?? 0,
    w.screen?.height ?? 0,
  );
}

function computeAndroidInset(androidHeight: number): number {
  if (!isNativeAndroid || typeof window === "undefined") return 0;
  const vv = window.visualViewport;
  const viewportHeight = vv?.height ?? window.innerHeight ?? 0;
  if (viewportHeight <= 0) return Math.max(0, androidHeight);

  if (androidHeight <= 0) {
    // Keyboard closed — widen baseline so subsequent open math is correct.
    const next = Math.max(
      androidBaselineHeight,
      viewportHeight,
      window.innerHeight ?? 0,
      document?.documentElement?.clientHeight ?? 0,
    );
    if (next > androidBaselineHeight) androidBaselineHeight = next;
    return 0;
  }

  if (androidBaselineHeight <= 0) {
    androidBaselineHeight = viewportHeight;
  }

  const viewportShrink = Math.max(0, androidBaselineHeight - viewportHeight);
  const viewportPan = Math.max(0, vv?.offsetTop ?? 0);
  const consumedByViewport = Math.min(androidHeight, Math.max(viewportShrink, viewportPan));
  return Math.max(0, androidHeight - consumedByViewport);
}

/**
 * Returns the current soft-keyboard height (in CSS px) on native platforms.
 *
 * CRITICAL: this hook computes the Android inset SYNCHRONOUSLY during render
 * (not via useState + useLayoutEffect). Previously the inset lagged the raw
 * `androidHeight` by one paint, which produced a render where
 * `useKeyboardOpen()` was already true but `useNativeKeyboardHeight()` was
 * still 0. On that single render, the chat shell didn't shrink and the fixed
 * composer was positioned at viewport bottom (behind the keyboard). Virtuoso
 * pinned to that incorrect bottom; one paint later when the inset caught up,
 * the composer lifted but the scroll position was now past the new visible
 * bottom — leaving the latest message clipped behind the composer.
 */
export function useNativeKeyboardHeight(): number {
  const iosState = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  const [, forceTick] = useReducer((n: number) => n + 1, 0);
  const lastVvSignatureRef = useRef<string>("");

  // visualViewport can change without a React re-render (Gboard toolbar,
  // predictive bar). Subscribe to it and force a tick so the synchronous
  // compute below sees the latest values.
  useEffect(() => {
    if (!isNativeAndroid || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => {
      const sig = `${Math.round(vv.height)}:${Math.round(vv.offsetTop)}:${Math.round(window.innerHeight)}`;
      if (sig !== lastVvSignatureRef.current) {
        lastVvSignatureRef.current = sig;
        forceTick();
      }
    };
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  if (isNativeAndroid) return computeAndroidInset(androidHeight);
  return iosState.keyboardHeight;
}
