import { useEffect, useState } from "react";

const KEYBOARD_OPEN_THRESHOLD = 100;

const isComposerElement = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!element?.closest("input, textarea, [contenteditable='true']");
};

/**
 * Detects soft keyboard visibility for chat threads.
 * Falls back to composer focus for platforms where visualViewport does not shrink reliably.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    let baselineHeight = vv?.height ?? window.innerHeight;

    const update = () => {
      const activeComposerFocused = isComposerElement(document.activeElement);
      const viewportHeight = vv?.height ?? window.innerHeight;

      if (viewportHeight > baselineHeight) {
        baselineHeight = viewportHeight;
      }

      const viewportIndicatesKeyboard = baselineHeight - viewportHeight > threshold;
      setIsKeyboardOpen(activeComposerFocused || viewportIndicatesKeyboard);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isComposerElement(event.target)) return;
      setIsKeyboardOpen(true);
    };

    const handleFocusOut = () => {
      requestAnimationFrame(update);
    };

    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);

    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
    };
  }, [threshold]);

  return isKeyboardOpen;
}
