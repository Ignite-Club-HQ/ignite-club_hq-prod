import { useLayoutEffect, useRef, useState } from "react";

const getInitialViewportHeight = () => {
  if (typeof window === "undefined") return null;

  return window.visualViewport?.height ?? window.innerHeight ?? null;
};

/**
 * Tracks the visual viewport height and returns a CSS height string
 * that dynamically adjusts when the keyboard opens/closes.
 *
 * On chat thread pages the container must shrink when the soft keyboard
 * appears so the scroll area doesn't extend behind it. --stable-vh is
 * intentionally static (good for non-chat pages) but breaks scrolling
 * inside chat threads when the keyboard is up.
 */
export function useChatViewportHeight(headerOffset = "4rem") {
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

    // Initial
    setVpHeight(vv.height);
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Fallback to --stable-vh / 100vh when visualViewport isn't available
  if (vpHeight === null) {
    return `calc(var(--stable-vh, 100vh) - ${headerOffset})`;
  }

  return `calc(${vpHeight}px - ${headerOffset})`;
}
