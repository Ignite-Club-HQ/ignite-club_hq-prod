import { useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

const isNativeIOS =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

/**
 * Returns the current soft-keyboard height (in CSS px) on native iOS.
 * On Android / web this always returns 0 because those environments
 * handle keyboard offset automatically (adjustResize / dvh).
 */
export function useNativeKeyboardHeight(): number {
  const [kbHeight, setKbHeight] = useState(0);
  const baselineRef = useRef<number>(0);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!isNativeIOS) return;

    const vv = window.visualViewport;
    if (!vv) return;

    // Capture baseline (full viewport with no keyboard)
    baselineRef.current = vv.height;

    const update = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // Update baseline if viewport grew (orientation change, etc.)
        if (vv.height > baselineRef.current) {
          baselineRef.current = vv.height;
        }
        const diff = Math.max(0, baselineRef.current - vv.height);
        setKbHeight(diff);
      });
    };

    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return isNativeIOS ? kbHeight : 0;
}
