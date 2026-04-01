import { useEffect, useState } from "react";

const KEYBOARD_OPEN_THRESHOLD = 100;

/**
 * Detects soft keyboard visibility using visualViewport height changes.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let baselineHeight = vv.height;

    const update = () => {
      if (vv.height > baselineHeight) {
        baselineHeight = vv.height;
      }
      setIsKeyboardOpen(baselineHeight - vv.height > threshold);
    };

    update();
    vv.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
    };
  }, [threshold]);

  return isKeyboardOpen;
}
