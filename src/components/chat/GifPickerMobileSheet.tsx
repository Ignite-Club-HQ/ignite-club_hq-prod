import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GifGrid } from "@/components/chat/GifGrid";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

const SHEET_DEFAULT_HEIGHT = 420;
const SHEET_MIN_HEIGHT = 248;
const SCREEN_EDGE_GAP = 8;

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

  if (!open) return null;

  const visualKeyboardHeight = Math.max(
    0,
    layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop),
  );
  const keyboardHeight = Math.max(iosKeyboardHeight, androidKeyboardHeight, visualKeyboardHeight);
  const bottomOffset = keyboardHeight > 0 ? keyboardHeight + SCREEN_EDGE_GAP : 0;
  const maxAvailableHeight = Math.max(
    SHEET_MIN_HEIGHT,
    layoutViewportHeight - bottomOffset - SCREEN_EDGE_GAP,
  );
  const preferredHeight = keyboardHeight > 0
    ? maxAvailableHeight
    : searchActive
      ? Math.max(SHEET_DEFAULT_HEIGHT, Math.round(layoutViewportHeight * 0.84))
      : SHEET_DEFAULT_HEIGHT;
  const sheetHeight = Math.min(maxAvailableHeight, preferredHeight);

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[100000] transition-opacity duration-200 ${searchActive ? "bg-background/35" : "bg-background/15"}`}
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