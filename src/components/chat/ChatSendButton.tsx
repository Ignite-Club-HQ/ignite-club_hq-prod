import { useEffect, useRef, useState } from "react";
import { Loader2, Send, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticImpactLight } from "@/lib/haptics";

const HINT_STORAGE_KEY = "chat:send-long-press-hint:v1";
const SEND_COUNT_KEY = "chat:send-count";
const HINT_AFTER_SENDS = 3;
const LONG_PRESS_MS = 350;

interface ChatSendButtonProps {
  onSend: () => void;
  /** Called when the user long-presses (or right-clicks) the send button. */
  onSchedule?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Set true when there's something to send — affects the "send count" tracking. */
  canSend?: boolean;
  className?: string;
}

/**
 * Primary send button with a long-press / right-click affordance for opening
 * the schedule-message sheet. Shows a one-time discoverability hint after the
 * user has sent a few messages.
 */
export function ChatSendButton({
  onSend,
  onSchedule,
  disabled,
  loading,
  canSend = true,
  className,
}: ChatSendButtonProps) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  // Tracks whether the current gesture has already fired onSend, so the
  // follow-up synthetic click (after pointerup) doesn't double-send.
  const firedThisGestureRef = useRef(false);
  // Guards against accidental sends from swipe-type / gesture-typing where
  // the pointer ENDS on the send button but never began on it. Only a tap
  // that actually started on this button is allowed to fire.
  const pointerDownOnUsRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => cancelTimer(), []);

  const dismissHint = () => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const maybeShowHint = () => {
    if (!onSchedule) return;
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY)) return;
      const next = (parseInt(localStorage.getItem(SEND_COUNT_KEY) || "0", 10) || 0) + 1;
      localStorage.setItem(SEND_COUNT_KEY, String(next));
      if (next >= HINT_AFTER_SENDS) {
        setShowHint(true);
        window.setTimeout(() => dismissHint(), 6000);
      }
    } catch {
      /* ignore */
    }
  };

  const fireSend = () => {
    if (firedThisGestureRef.current) return;
    if (disabled || loading) return;
    firedThisGestureRef.current = true;
    // Clear light impact — matches WhatsApp/Telegram send feel (selectionChanged was too subtle to perceive).
    hapticImpactLight();
    onSend();
    if (canSend) maybeShowHint();
    // Reset shortly after so subsequent gestures can fire.
    window.setTimeout(() => {
      firedThisGestureRef.current = false;
    }, 300);
  };

  const handleClick = () => {
    // Fallback for mouse/keyboard — pointerup path already fired on touch.
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    fireSend();
  };

  const startLongPress = (e: React.PointerEvent) => {
    longPressedRef.current = false;
    firedThisGestureRef.current = false;
    pointerDownOnUsRef.current = true;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    setPressing(true);
    cancelTimer();
    if (!onSchedule || disabled || loading) return;
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setPressing(false);
      dismissHint();
      onSchedule();
    }, LONG_PRESS_MS);
  };

  const endLongPress = (e?: React.PointerEvent) => {
    cancelTimer();
    setPressing(false);
    // Only fire on a clean tap that BEGAN on this button. This rejects
    // swipe-typing gestures that happen to end over the send icon — the
    // root cause of garbled messages like "wothpur" being sent mid-word.
    const startedOnUs = pointerDownOnUsRef.current;
    pointerDownOnUsRef.current = false;
    if (!e || e.type !== "pointerup") return;
    if (!startedOnUs) return;
    if (longPressedRef.current) return;
    // Reject if pointer drifted significantly (treat as swipe, not tap).
    const start = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 24 * 24) return;
    }
    fireSend();
  };


  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onSchedule) return;
    e.preventDefault();
    longPressedRef.current = true;
    dismissHint();
    onSchedule();
  };

  return (
    <div className="relative inline-flex">
      {showHint && (
        <button
          type="button"
          onClick={dismissHint}
          aria-label="Dismiss hint"
          className="absolute bottom-full right-0 mb-2 z-50 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background text-[11px] font-medium px-2.5 py-1.5 shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-bottom-1"
        >
          <CalendarClock className="h-3 w-3" aria-hidden="true" />
          Hold send to schedule
        </button>
      )}
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={startLongPress}
        onPointerUp={endLongPress}
        onPointerLeave={() => endLongPress()}
        onPointerCancel={() => endLongPress()}
        onContextMenu={handleContextMenu}
        disabled={disabled || loading}
        aria-label={onSchedule ? "Send message (hold to schedule)" : "Send message"}
        title={onSchedule ? "Send · Hold to schedule" : "Send"}
        className={cn(
          // 44x44 hit target via padding; inner visual stays 30px. Negative
          // margin prevents the expanded target from shifting layout.
          // `mb-[5px]` lifts the button up so its optical center aligns with
          // the text baseline on a single-line composer (and keeps a
          // comfortable bottom inset when the composer grows multi-line —
          // matching WhatsApp/Messenger anchoring).
          "group relative flex items-center justify-center shrink-0 p-1 -m-1 mb-[5px] rounded-full bg-transparent select-none touch-none",
          className,
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center h-[30px] w-[30px] rounded-full transition-all duration-200 ease-out",
            canSend
              ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.15),0_2px_6px_-2px_hsl(var(--primary)/0.40)] scale-100 group-hover:bg-primary/95 group-active:bg-primary/90 group-active:scale-95"
              : "bg-transparent text-muted-foreground/85 shadow-none scale-95",
            pressing && canSend && "scale-110 ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            // Optical nudge: Send icon's visual mass sits top-right, so shift
            // slightly down-left so it reads as centered in the circle.
            <Send className="h-4 w-4 translate-x-[-0.5px] translate-y-[0.5px]" strokeWidth={2.2} />
          )}
        </span>
      </button>
    </div>
  );
}
