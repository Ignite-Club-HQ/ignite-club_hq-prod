import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GifGrid } from "@/components/chat/GifGrid";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

/**
 * Mobile GIPHY bottom sheet — fully keyboard-aware.
 *
 * Single source of truth: the keyboard height drives BOTH the panel's bottom
 * offset and its height. The panel never relies on a fixed/initial layout
 * once the keyboard is open — every keyboard show/hide event triggers a full
 * re-measure, so the sheet always sits flush above the keyboard with the
 * search input pinned at the top and the grid scrolling within.
 */
const SHEET_DEFAULT_HEIGHT = 420;
const SHEET_MIN_HEIGHT = 240;
const TOP_GAP = 12;             // gap between sheet top and status bar / header
const KEYBOARD_GAP = 4;         // tiny gap between sheet bottom and keyboard top
const KEYBOARD_OPEN_THRESHOLD = 80;

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

  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const measure = () => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    };

    // Schedule re-measures across the keyboard animation window so the panel
    // always settles at the final correct size (iOS keyboard ~250-300ms,
    // Android ~150-250ms). This is the "consistency guarantee" — every
    // show/hide cycle ends in a full recalculation.
    const scheduleSettle = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [50, 150, 300, 500].map((delay) =>
        window.setTimeout(measure, delay),
      );
    };

    measure();
    scheduleSettle();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", scheduleSettle);
    vv?.addEventListener("scroll", scheduleSettle);
    window.addEventListener("resize", scheduleSettle);
    window.addEventListener("orientationchange", scheduleSettle);
    window.addEventListener("focusin", scheduleSettle);
    window.addEventListener("focusout", scheduleSettle);

    return () => {
      vv?.removeEventListener("resize", scheduleSettle);
      vv?.removeEventListener("scroll", scheduleSettle);
      window.removeEventListener("resize", scheduleSettle);
      window.removeEventListener("orientationchange", scheduleSettle);
      window.removeEventListener("focusin", scheduleSettle);
      window.removeEventListener("focusout", scheduleSettle);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [];
    };
  }, [open]);

  // Re-measure whenever the native keyboard hooks report a change. This is
  // the explicit "listen for keyboard show/hide events" requirement and the
  // guarantee that the panel re-layouts on every keyboard transition.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const id = window.setTimeout(() => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, iosKeyboardHeight, androidKeyboardHeight]);

  const { sheetHeight, bottomOffset, keyboardOpen } = useMemo(() => {
    const visualKeyboard = Math.max(
      0,
      layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop),
    );
    // Keyboard height is the SINGLE SOURCE OF TRUTH for layout.
    const kb = Math.max(iosKeyboardHeight, androidKeyboardHeight, visualKeyboard);
    const isKbOpen = kb > KEYBOARD_OPEN_THRESHOLD;

    const offset = isKbOpen ? kb + KEYBOARD_GAP : 0;
    const available = Math.max(SHEET_MIN_HEIGHT, layoutViewportHeight - offset - TOP_GAP);

    // Deterministic height policy:
    //   - keyboard open  → always fill available space (consistent every time)
    //   - search active  → expand toward full screen
    //   - otherwise      → default compact height
    let preferred: number;
    if (isKbOpen) {
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