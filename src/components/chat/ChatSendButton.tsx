import { useEffect, useRef, useState } from "react";
import { Loader2, Send, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const handleTap = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (disabled || loading) return;
    onSend();
    if (canSend) maybeShowHint();
  };

  const startLongPress = () => {
    if (!onSchedule || disabled || loading) return;
    longPressedRef.current = false;
    setPressing(true);
    cancelTimer();
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setPressing(false);
      dismissHint();
      onSchedule();
    }, LONG_PRESS_MS);
  };

  const endLongPress = () => {
    cancelTimer();
    setPressing(false);
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
        onClick={handleTap}
        onPointerDown={startLongPress}
        onPointerUp={endLongPress}
        onPointerLeave={endLongPress}
        onPointerCancel={endLongPress}
        onContextMenu={handleContextMenu}
        disabled={disabled || loading}
        aria-label={onSchedule ? "Send message (hold to schedule)" : "Send message"}
        title={onSchedule ? "Send · Hold to schedule" : "Send"}
        className={cn(
          "flex items-center justify-center h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12),0_2px_6px_-2px_hsl(var(--primary)/0.45)] hover:bg-primary/95 active:bg-primary/90 disabled:bg-muted/70 disabled:text-muted-foreground/50 disabled:shadow-none transition-all duration-150 ease-out select-none touch-none",
          pressing && "scale-110 ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
          className,
        )}
      >
        {loading ? (
          <Loader2 className="h-[17px] w-[17px] animate-spin" />
        ) : (
          // Optical nudge: Send icon's visual mass sits right-of-center, so shift left ~1px
          <Send className="h-[17px] w-[17px] -ml-px" />
        )}
      </button>
    </div>
  );
}
