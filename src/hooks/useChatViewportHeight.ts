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
  // Web: use pure CSS — no JS viewport tracking needed
  if (!isNative) {
    return `calc(100dvh - ${headerOffset})`;
  }

  // Native: track visualViewport for keyboard handling
  const [vpHeight, setVpHeight] = useState<number | null>(getInitialViewportHeight);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
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

  if (vpHeight === null) {
    return `calc(var(--stable-vh, 100vh) - ${headerOffset})`;
  }

  return `calc(${vpHeight}px - ${headerOffset})`;
}
