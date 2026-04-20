import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GifGrid } from "@/components/chat/GifGrid";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

/**
 * Mobile GIPHY bottom sheet — fully keyboard-aware.
 *
 * Behavior:
 *  - Closed keyboard: fixed default height pinned to viewport bottom.
 *  - Open keyboard:   bottom anchored to top of keyboard, height fills the
 *                     space above (minus a small gap) so the search input is
 *                     always visible and the grid scrolls within.
 *  - Active search:   sheet expands toward full screen for focused browsing.
 */
const SHEET_DEFAULT_HEIGHT = 420;
const SHEET_MIN_HEIGHT = 240;
const TOP_GAP = 12;        // gap between sheet top and status bar / header
const KEYBOARD_GAP = 4;    // tiny gap between sheet bottom and keyboard top

interface GifPickerMobileSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
}

/**
 * Full-width mobile GIF picker that anchors to the visualViewport bottom so
 * it always sits flush above the soft keyboard. Uses a portal to escape any
 * transformed parent containers.
 */
export function GifPickerMobileSheet({ open, onClose, onSelect }: GifPickerMobileSheetProps) {
  const { keyboardHeight: iosKeyboardHeight } = useNativeIOSKeyboardState();
  const androidKeyboardHeight = useNativeAndroidKeyboardState();
  const [layoutViewportHeight, setLayoutViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [visualViewportHeight, setVisualViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : (window.visualViewport?.height ?? window.innerHeight),
  );
  const [visualViewportOffsetTop, setVisualViewportOffsetTop] = useState(() =>
    typeof window === "undefined" ? 0 : (window.visualViewport?.offsetTop ?? 0),
  );
  const [searchActive, setSearchActive] = useState(false);

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;

      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    };

    if (!open) return;

    const vv = window.visualViewport;
    update();

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    const onFocus = () => {
      update();
      setTimeout(update, 100);
      setTimeout(update, 300);
    };

    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onFocus);

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("focusout", onFocus);
    };
  }, [open]);

  const { sheetHeight, bottomOffset, keyboardOpen } = useMemo(() => {
    const visualKeyboard = Math.max(
      0,
      layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop),
    );
    const kb = Math.max(iosKeyboardHeight, androidKeyboardHeight, visualKeyboard);
    const isKbOpen = kb > 80; // ignore tiny rounding deltas

    const offset = isKbOpen ? kb + KEYBOARD_GAP : 0;
    const available = Math.max(SHEET_MIN_HEIGHT, layoutViewportHeight - offset - TOP_GAP);

    let preferred: number;
    if (isKbOpen) {
      // Always fill the available space — guarantees consistent layout.
      preferred = available;
    } else if (searchActive) {
      preferred = Math.max(SHEET_DEFAULT_HEIGHT, Math.round(layoutViewportHeight * 0.84));
    } else {
      preferred = SHEET_DEFAULT_HEIGHT;
    }

    return {
      sheetHeight: Math.min(available, preferred),
      bottomOffset: offset,
      keyboardOpen: isKbOpen,
    };
  }, [
    layoutViewportHeight,
    visualViewportHeight,
    visualViewportOffsetTop,
    iosKeyboardHeight,
    androidKeyboardHeight,
    searchActive,
  ]);

  if (!open) return null;

  const focused = searchActive || keyboardOpen;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[100000] transition-opacity duration-200 ${focused ? "bg-background/40" : "bg-background/15"}`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />

      <div
        className="fixed left-0 right-0 z-[100001] flex flex-col overflow-hidden rounded-t-2xl border-x border-t bg-popover text-popover-foreground shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        style={{
          bottom: bottomOffset,
          height: sheetHeight,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          transition: "bottom 180ms cubic-bezier(0.32, 0.72, 0, 1), height 180ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
          <div className="flex-1 flex justify-center">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GIF picker"
            className="absolute right-2 top-2 h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent active:scale-95 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 px-3 pb-2 flex flex-col">
          <GifGrid
            active
            onSelect={onSelect}
            onQueryChange={(query) => setSearchActive(query.trim().length > 0)}
            scrollClassName="flex-1 min-h-0"
            gridClassName="grid-cols-2"
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    </>,
    document.body,
  );
}