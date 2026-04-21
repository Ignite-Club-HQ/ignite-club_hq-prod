import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GifGrid } from "@/components/chat/GifGrid";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

/**
 * Mobile GIPHY bottom sheet — fully keyboard-aware.
 *
 * Root issue on Android native: a fixed element can remain visually pinned to
 * the layout viewport bottom while the soft keyboard is effectively changing
 * the visible bottom edge through native insets / visual viewport updates.
 *
 * Fix: compute the actual keyboard top and position the sheet with an explicit
 * `top` value, not a `bottom` value. This makes the panel track the real
 * visible area above the keyboard across viewport models.
 */
const SHEET_DEFAULT_HEIGHT = 420;
const SHEET_MIN_HEIGHT = 240;
const TOP_GAP = 8;
const KEYBOARD_GAP = 0;
const KEYBOARD_OPEN_THRESHOLD = 80;

interface GifPickerMobileSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
}

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
  const [inputFocused, setInputFocused] = useState(false);

  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const lastMeasuredKeyboardTopRef = useRef(0);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const measure = () => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    };

    const scheduleSettle = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [50, 150, 300, 500].map((delay) => window.setTimeout(measure, delay));
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

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const id = window.setTimeout(() => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, iosKeyboardHeight, androidKeyboardHeight]);

  useEffect(() => {
    if (!open) {
      setSearchActive(false);
      setInputFocused(false);
      lastMeasuredKeyboardTopRef.current = 0;
      return;
    }

    if (lastMeasuredKeyboardTopRef.current <= 0) {
      lastMeasuredKeyboardTopRef.current = layoutViewportHeight;
    }
  }, [layoutViewportHeight, open]);

  const { sheetHeight, sheetTop, keyboardOpen } = useMemo(() => {
    const nativeKeyboardHeight = Math.max(iosKeyboardHeight, androidKeyboardHeight);
    const visualViewportBottom = visualViewportOffsetTop + visualViewportHeight;
    const visualKeyboardHeight = Math.max(0, layoutViewportHeight - visualViewportBottom);
    const keyboardHeight = Math.max(nativeKeyboardHeight, visualKeyboardHeight);
    const isKeyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;
    const keyboardSessionActive = isKeyboardOpen || inputFocused || searchActive;

    const nativeKeyboardTop = layoutViewportHeight - nativeKeyboardHeight;
    const visualKeyboardTop = visualViewportBottom;
    const measuredKeyboardTop = Math.min(nativeKeyboardTop, visualKeyboardTop);
    const hasMeasuredKeyboardTop = measuredKeyboardTop < layoutViewportHeight - KEYBOARD_GAP;

    if (hasMeasuredKeyboardTop) {
      lastMeasuredKeyboardTopRef.current = measuredKeyboardTop;
    } else if (!keyboardSessionActive) {
      lastMeasuredKeyboardTopRef.current = layoutViewportHeight;
    }

    const keyboardTop = keyboardSessionActive
      ? (hasMeasuredKeyboardTop ? measuredKeyboardTop : lastMeasuredKeyboardTopRef.current || layoutViewportHeight)
      : layoutViewportHeight;

    const availableHeight = Math.max(SHEET_MIN_HEIGHT, keyboardTop - TOP_GAP - KEYBOARD_GAP);
    const compactHeight = Math.min(
      SHEET_DEFAULT_HEIGHT,
      Math.max(SHEET_MIN_HEIGHT, layoutViewportHeight - TOP_GAP - 16),
    );
    // Always maximise to the available area above the keyboard for consistency.
    const preferredHeight = keyboardSessionActive ? availableHeight : compactHeight;
    const nextSheetHeight = Math.min(availableHeight, preferredHeight);
    const nextSheetTop = keyboardSessionActive
      ? Math.max(TOP_GAP, keyboardTop - nextSheetHeight)
      : Math.max(TOP_GAP, keyboardTop - KEYBOARD_GAP - nextSheetHeight);

    return {
      sheetHeight: nextSheetHeight,
      sheetTop: nextSheetTop,
      keyboardOpen: isKeyboardOpen,
    };
  }, [
    androidKeyboardHeight,
    inputFocused,
    iosKeyboardHeight,
    layoutViewportHeight,
    searchActive,
    visualViewportHeight,
    visualViewportOffsetTop,
  ]);

  if (!open) return null;

  const focused = searchActive || inputFocused || keyboardOpen;

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
          top: sheetTop,
          height: sheetHeight,
          paddingBottom: keyboardOpen ? 0 : "env(safe-area-inset-bottom, 0px)",
          transition: "top 180ms cubic-bezier(0.32, 0.72, 0, 1), height 180ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Header */}
        <div className="relative flex items-center justify-center px-3 pt-1.5 pb-0.5 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GIF picker"
            className="absolute right-1.5 top-1 h-7 w-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent active:scale-95 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 px-3 pb-1 flex flex-col">
          <GifGrid
            active
            onSelect={onSelect}
            onQueryChange={(query) => setSearchActive(query.trim().length > 0)}
            onFocusChange={setInputFocused}
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