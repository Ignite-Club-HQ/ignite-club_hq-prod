import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GifGrid } from "@/components/chat/GifGrid";

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
  const [baselineHeight, setBaselineHeight] = useState(0);
  const [bottomOffset, setBottomOffset] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(420);

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const nextBaseline = vv.height + vv.offsetTop;
    setBaselineHeight(nextBaseline);

    const update = () => {
      const currentVisibleHeight = vv.height + vv.offsetTop;
      const referenceHeight = Math.max(baselineHeight || nextBaseline, currentVisibleHeight);
      const offset = Math.max(0, referenceHeight - currentVisibleHeight);
      const nextHeight = Math.max(220, Math.min(520, vv.height - 12));

      setBottomOffset(offset);
      setSheetHeight(nextHeight);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Re-measure shortly after focus events — keyboards often animate in
    // after the focus event fires.
    const onFocus = () => {
      update();
      setTimeout(update, 100);
      setTimeout(update, 300);
    };
    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("focusout", onFocus);
    };
  }, [open, baselineHeight]);

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop — tap to dismiss */}
      <div
        className="fixed inset-0 z-[100000] bg-transparent"
        onPointerDown={(e) => {
          // Only close if tapping the backdrop itself
          if (e.target === e.currentTarget) onClose();
        }}
      />

      {/* Anchored sheet */}
      <div
        className="fixed left-0 right-0 z-[100001] flex flex-col rounded-t-2xl border-t border-x bg-popover text-popover-foreground shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
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