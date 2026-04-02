import { useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();

const getInitialViewportHeight = () => {
  if (typeof window === "undefined") return null;
  return window.visualViewport?.height ?? window.innerHeight ?? null;
};

/**
 * Tracks the visual viewport height and returns a CSS height string
 * that dynamically adjusts when the keyboard opens/closes.
 *
 * On **native** (Capacitor) the container must shrink via visualViewport
 * when the soft keyboard appears.
 *
 * On **web** (Lovable preview / browsers) we use 100dvh which the browser
 * handles automatically — tracking visualViewport on web causes the header
 * to scroll out of view because the browser itself scrolls the page.
 */
export function useChatViewportHeight(headerOffset = "4rem") {
  const [vpHeight, setVpHeight] = useState<number | null>(
    isNative ? getInitialViewportHeight() : null
  );
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    // On web we don't need JS viewport tracking
    if (!isNative) return;

    const vv = window.visualViewport;
    if (!vv) {
      setVpHeight(window.innerHeight);
      return;
    }

    const update = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setVpHeight(vv.height);
      });
    };

    setVpHeight(vv.height);
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Web: pure CSS approach
  if (!isNative) {
    return `calc(100dvh - ${headerOffset})`;
  }

  // Native: JS-tracked viewport
  if (vpHeight === null) {
    return `calc(var(--stable-vh, 100vh) - ${headerOffset})`;
  }

  return `calc(${vpHeight}px - ${headerOffset})`;
}
