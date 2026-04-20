import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
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
const TOP_GAP = 12;
const KEYBOARD_GAP = 4;
const KEYBOARD_OPEN_THRESHOLD = 80;
const isNative = Capacitor.isNativePlatform();

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

  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

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

  const { sheetHeight, sheetTop, keyboardOpen } = useMemo(() => {
    const nativeKeyboardHeight = Math.max(iosKeyboardHeight, androidKeyboardHeight);
    const visualViewportBottom = visualViewportOffsetTop + visualViewportHeight;
    const visualKeyboardHeight = Math.max(0, layoutViewportHeight - visualViewportBottom);
    const keyboardHeight = Math.max(nativeKeyboardHeight, visualKeyboardHeight);
    const isKeyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;

    const nativeKeyboardTop = layoutViewportHeight - nativeKeyboardHeight;
    const visualKeyboardTop = visualViewportBottom;
    const keyboardTop = isKeyboardOpen
      ? Math.min(nativeKeyboardTop, visualKeyboardTop)
      : layoutViewportHeight;

    const availableHeight = Math.max(SHEET_MIN_HEIGHT, keyboardTop - TOP_GAP - KEYBOARD_GAP);
    const compactHeight = Math.min(
      SHEET_DEFAULT_HEIGHT,
      Math.max(SHEET_MIN_HEIGHT, layoutViewportHeight - TOP_GAP - 16),
    );
    const preferredHeight = isKeyboardOpen
      ? availableHeight
      : searchActive
        ? Math.max(compactHeight, Math.round(layoutViewportHeight * 0.84))
        : compactHeight;
    const nextSheetHeight = Math.min(availableHeight, preferredHeight);
    const nextSheetTop = Math.max(TOP_GAP, keyboardTop - KEYBOARD_GAP - nextSheetHeight);

    return {
      sheetHeight: nextSheetHeight,
      sheetTop: nextSheetTop,
      keyboardOpen: isKeyboardOpen,
    };
  }, [
    androidKeyboardHeight,
    iosKeyboardHeight,
    layoutViewportHeight,
    searchActive,
    visualViewportHeight,
    visualViewportOffsetTop,
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