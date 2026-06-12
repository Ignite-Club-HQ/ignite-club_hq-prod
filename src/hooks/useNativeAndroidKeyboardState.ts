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

    // Track last reported plugin height so visualViewport-driven reconciliation
    // can run while the keyboard is open (e.g. Gboard toolbar toggle, emoji
    // panel, predictive bar appearing). Without this, the composer pins to a
    // stale show-time value and drifts mid-session.
    let pluginHeight = 0;
    let keyboardOpen = false;
    let baselineLayoutHeight = typeof window !== "undefined" ? window.innerHeight : 0;

    const readCssPx = (name: string) => {
      if (typeof window === "undefined" || typeof document === "undefined") return 0;
      const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getLayoutBaseline = () => {
      const current = typeof window !== "undefined" ? window.innerHeight : 0;
      const lockedVisual = readCssPx("--visual-vh");
      baselineLayoutHeight = Math.max(baselineLayoutHeight, current, lockedVisual);
      return baselineLayoutHeight;
    };

    const applyHeight = (nextHeight: number) => {
      const rounded = Math.max(0, Math.round(nextHeight));
      setKeyboardHeight((current) => (current === rounded ? current : rounded));
    };

    const computeHeight = (rawPluginHeight: number): number => {
      const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
      const layoutH = typeof window !== "undefined" ? window.innerHeight : 0;
      const baselineH = getLayoutBaseline();
      const raw = rawPluginHeight || 0;
      const looksLikeDevicePx = layoutH > 0 && raw > layoutH * 0.6;
      let finalHeight = looksLikeDevicePx ? raw / dpr : raw;

      // visualViewport-derived TOTAL inset is the source of truth whenever
      // credible. Compare against the locked/pre-keyboard layout baseline, not
      // current innerHeight: OEM WebViews can partially shrink innerHeight even
      // with Keyboard.resize='none', and using current innerHeight returns only
      // the overlay remainder. The chat shell needs the total hidden region.
      if (typeof window !== "undefined") {
        const vv = window.visualViewport;
        const vvTotalInset = vv && baselineH > 0
          ? Math.max(0, baselineH - vv.height)
          : 0;
        if (vvTotalInset > 24) {
          finalHeight = vvTotalInset;
        }
      }

      if (baselineH > 0) {
        finalHeight = Math.min(finalHeight, baselineH * 0.6);
      }
      return Math.max(0, finalHeight);
    };

    const reconcile = () => {
      if (!keyboardOpen) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyHeight(computeHeight(pluginHeight));
      });
    };

    const handleShow = ({ keyboardHeight: h }: { keyboardHeight: number }) => {
      pluginHeight = h || 0;
      keyboardOpen = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyHeight(computeHeight(pluginHeight));
      });
    };

    const handleHide = () => {
      pluginHeight = 0;
      keyboardOpen = false;
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

    // Continuous reconciliation against visualViewport while the keyboard
    // is open. Catches: IME toolbar toggle, emoji/GIF panel switching,
    // predictive bar appearing, voice input, OEM keyboards that don't
    // refire Capacitor events on resize.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const handleWindowResize = () => {
      if (!keyboardOpen) {
        getLayoutBaseline();
        return;
      }
      reconcile();
    };

    vv?.addEventListener("resize", reconcile);
    vv?.addEventListener("scroll", reconcile);
    window.addEventListener("resize", handleWindowResize);

    // Re-measure when an editable element gains focus while the keyboard
    // may already be open (e.g. tapping Reply re-focuses the composer
    // textarea without a new keyboardWillShow firing).
    const handleFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable) {
        // Give the IME a tick to settle, then reconcile against vv.
        setTimeout(() => {
          if (typeof window !== "undefined" && window.visualViewport) {
            const layoutH = window.innerHeight;
            const vvShrink = Math.max(0, layoutH - window.visualViewport.height);
            if (vvShrink > 24) {
              keyboardOpen = true;
              reconcile();
            }
          }
        }, 50);
      }
    };
    document.addEventListener("focusin", handleFocusIn, true);

    // Safety net: Capacitor's keyboardDidHide can be missed on Android when
    // the user navigates away before the keyboard finishes its hide animation.
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
        if (!isEditable(document.activeElement)) {
          keyboardOpen = false;
          pluginHeight = 0;
          applyHeight(0);
        }
      }, 250);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isEditable(document.activeElement)) {
        keyboardOpen = false;
        pluginHeight = 0;
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
      vv?.removeEventListener("resize", reconcile);
      vv?.removeEventListener("scroll", reconcile);
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(focusoutTimer);
      cancelAnimationFrame(rafRef.current);
    };

  }, []);

  return isNativeAndroid ? keyboardHeight : 0;
}
