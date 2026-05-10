import { useEffect, useRef, useState } from "react";

/**
 * Returns true once the visual viewport height has been stable (no change)
 * for `quietMs` milliseconds. Used to delay first paint of the virtualised
 * chat list so Virtuoso pins to the bottom against the FINAL viewport
 * height, not an interim one — preventing the "land then jolt up/down"
 * flicker on chat open caused by visualViewport reflow finishing after
 * mount (status bar, URL bar collapse, keyboard auto-dismiss, etc.).
 */
export function useViewportHeightSettled(quietMs: number = 120): boolean {
  const [settled, setSettled] = useState(false);
  const lastHeightRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const getHeight = () => {
      if (typeof window === "undefined") return 0;
      return window.visualViewport?.height ?? window.innerHeight;
    };

    const arm = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setSettled(true);
      }, quietMs);
    };

    const onChange = () => {
      const h = getHeight();
      if (h !== lastHeightRef.current) {
        lastHeightRef.current = h;
        setSettled(false);
        arm();
      }
    };

    lastHeightRef.current = getHeight();
    arm();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", onChange);
    window.addEventListener("resize", onChange);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      vv?.removeEventListener("resize", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [quietMs]);

  return settled;
}
