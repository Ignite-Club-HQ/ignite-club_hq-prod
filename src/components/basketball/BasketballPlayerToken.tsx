import { memo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BasketballPlayer, BasketballPosition, POSITION_COLORS } from "./types";
import { Pin, AlertTriangle, Ban } from "lucide-react";
import { useNowTick, formatRest } from "@/hooks/useNowTick";

interface BasketballPlayerTokenProps {
  player: BasketballPlayer;
  position?: BasketballPosition;
  variant?: "court" | "bench";
  isSelected?: boolean;
  isSwapTarget?: boolean;
  isInvalidTarget?: boolean;
  /** When true, dims this player so the user's eye is drawn to swap targets. */
  isDimmed?: boolean;
  /** Briefly glows the token after a recent swap (incoming/outgoing). */
  isRecentlySwapped?: boolean;
  isDragging?: boolean;
  isNextSub?: boolean;
  isLowestMinutes?: boolean;
  /** Subtle "should rest" hint from the coach assistant (faint amber outline). */
  isOverplayed?: boolean;
  onClick?: () => void;
  /** Long-press (~500ms) opens the quick action sheet (score, foul, injury…). */
  onLongPress?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  readOnly?: boolean;
  style?: React.CSSProperties;
}

const BasketballPlayerToken = memo(function BasketballPlayerToken({
  player,
  position,
  variant = "court",
  isSelected = false,
  isSwapTarget = false,
  isInvalidTarget = false,
  isDimmed = false,
  isRecentlySwapped = false,
  isDragging = false,
  isNextSub = false,
  isLowestMinutes = false,
  isOverplayed = false,
  onClick,
  onLongPress,
  onDragStart,
  onDragEnd,
  onTouchStart,
  readOnly = false,
  style,
}: BasketballPlayerTokenProps) {
  // Long-press detection — 500ms hold opens the quick action sheet without
  // hijacking the tap-to-swap flow. We bail if pointer moves >8px (drag) or
  // lifts before timer fires.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const handlePointerDown = (e: React.PointerEvent) => {
    if (readOnly || !onLongPress) return;
    longPressFiredRef.current = false;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress();
    }, 500);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressStartRef.current) return;
    const dx = e.clientX - pressStartRef.current.x;
    const dy = e.clientY - pressStartRef.current.y;
    if (dx * dx + dy * dy > 64) clearLongPress();
  };
  const handlePointerUp = () => clearLongPress();
  const handleClick = () => {
    // Suppress synthetic click after long-press release.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onClick?.();
  };
  const initials = player.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const pos = position ?? player.position;
  const colors = pos ? POSITION_COLORS[pos] : null;
  const minutes = Math.floor((player.minutesPlayed ?? 0) / 60);
  const fouled = !!player.isFouledOut;
  const fouls = player.fouls ?? 0;
  const points = player.points ?? 0;
  const ftAtt = player.ftAttempted ?? 0;
  const ftMade = player.ftMade ?? 0;
  // Bench rest timer — only meaningful for benched players with a stamp.
  const now = useNowTick(5000);
  const restSeconds =
    variant === "bench" && player.lastBenchedAt
      ? Math.max(0, Math.floor((now - player.lastBenchedAt) / 1000))
      : 0;

  return (
    <button
      type="button"
      draggable={!readOnly}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      style={style}
      aria-label={`${player.name}${pos ? ` at ${pos}` : " on bench"}${points > 0 ? `, ${points} points` : ""}`}
      className={cn(
        // Tight gap so token + label read as a single physical "piece" on the court.
        "relative flex flex-col items-center gap-0 touch-manipulation select-none",
        "transition-all duration-200 ease-out will-change-transform",
        // Court tokens are noticeably larger than bench chips so they dominate
        // the court visually (req: ~10–15% bigger).
        variant === "court" ? "w-16" : "w-12",
        isDragging && "opacity-40 scale-90",
        isSelected && "scale-110 z-20 drop-shadow-[0_0_16px_hsl(var(--primary)/0.75)] ring-2 ring-primary ring-offset-2 ring-offset-background rounded-full",
        isSwapTarget && !isInvalidTarget && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background rounded-full animate-pulse",
        isInvalidTarget && "ring-2 ring-destructive ring-offset-2 ring-offset-background rounded-full opacity-60",
        isDimmed && !isSelected && !isSwapTarget && "opacity-40",
        isRecentlySwapped && "drop-shadow-[0_0_16px_hsl(var(--primary)/0.85)] animate-fade-in",
        // "Suggested sub off" — clear amber/orange ring on the on-court candidate.
        isNextSub && !isSelected && variant === "court" &&
          "ring-2 ring-orange-400 ring-offset-2 ring-offset-background rounded-full animate-pulse drop-shadow-[0_0_12px_rgba(251,146,60,0.7)]",
        isNextSub && !isSelected && variant === "bench" &&
          "animate-pulse drop-shadow-[0_0_8px_hsl(var(--primary)/0.45)]",
        // "Suggested sub on" — bench player with lowest minutes glows green.
        isLowestMinutes && variant === "bench" && !isSelected &&
          "ring-2 ring-emerald-500 ring-offset-1 ring-offset-background rounded-full",
        // Coach-assistant "should rest" hint — very faint amber outline,
        // never competes with selection / swap-target rings.
        isOverplayed && variant === "court" && !isSelected && !isSwapTarget && !isNextSub &&
          "ring-1 ring-amber-400/70 ring-offset-1 ring-offset-background rounded-full",
        readOnly && "pointer-events-none",
        "active:scale-95",
      )}
    >
      {/* Foul-out (red Ban) takes priority over injury (yellow triangle) */}
      {fouled ? (
        <span
          className="absolute -top-1 -right-1 z-10 bg-destructive text-destructive-foreground rounded-full p-0.5"
          title="Fouled out"
        >
          <Ban className="h-3 w-3" />
        </span>
      ) : player.isInjured ? (
        <span className="absolute -top-1 -right-1 z-10 bg-destructive text-destructive-foreground rounded-full p-0.5">
          <AlertTriangle className="h-3 w-3" />
        </span>
      ) : player.isFillIn ? (
        <span className="absolute -top-1 -right-1 z-10 bg-amber-500 text-white rounded-full p-0.5">
          <Pin className="h-3 w-3" />
        </span>
      ) : null}
      {player.number !== undefined && (
        <span
          className="absolute -top-1 -left-1 z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-background border border-border text-[10px] font-bold text-foreground shadow-sm"
          aria-hidden
        >
          {player.number}
        </span>
      )}
      <div className="relative">
        <Avatar
          className={cn(
            // Stronger shadow + crisp outer ring for depth — players feel like
            // physical chips on the court.
            "shadow-[0_4px_10px_rgba(0,0,0,0.45),0_1px_2px_rgba(0,0,0,0.3)] transition-shadow",
            "ring-1 ring-black/20",
            variant === "court" ? "h-13 w-13 border-[3px]" : "h-10 w-10 border-2",
            fouled ? "border-destructive opacity-70" : (colors?.border ?? "border-border")
          )}
          style={variant === "court" ? { height: "3.25rem", width: "3.25rem" } : undefined}
        >
          <AvatarFallback
            className={cn(
              "font-extrabold relative",
              variant === "court" ? "text-sm" : "text-xs",
              colors?.bg,
              colors?.text,
              // Subtle inner top highlight gives the chip a 3D, glossy feel.
              "before:absolute before:inset-0 before:rounded-full before:pointer-events-none",
              "before:bg-[linear-gradient(180deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_55%)]"
            )}
          >
            <span className="relative z-10">{initials}</span>
          </AvatarFallback>
        </Avatar>
        {pos && (
          <span
            className={cn(
              "absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold rounded px-1 border shadow-sm",
              colors?.bg,
              colors?.text,
              colors?.border
            )}
          >
            {pos}
          </span>
        )}
        {points > 0 && (
          <span
            className="absolute -bottom-1 -right-1 z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm ring-1 ring-background"
            aria-hidden
          >
            {points}
          </span>
        )}
      </div>
      {/* Backed name+minutes label. On-court players get a high-contrast pill
          so text never sits directly on the court. Bench keeps the lighter
          treatment so the court visually dominates. */}
      {variant === "court" ? (
        <span
          className={cn(
            "mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md",
            "bg-background/95 border border-border shadow-sm backdrop-blur-sm",
            "text-[10px] font-semibold text-foreground leading-none max-w-[72px]"
          )}
        >
          <span className="truncate">{player.name.split(" ")[0]}</span>
          <span className="text-muted-foreground font-medium">·</span>
          <span className="tabular-nums text-foreground/80">
            {`${minutes}m`}
          </span>
          {fouls > 0 && (
            <span className={cn("tabular-nums", fouled ? "text-destructive font-bold" : "text-muted-foreground")}>
              · {fouls}F
            </span>
          )}
        </span>
      ) : (
        <>
          <span className="text-[10px] font-medium text-foreground/90 leading-tight text-center max-w-full truncate">
            {player.name.split(" ")[0]}
          </span>
          <span className="text-[9px] text-muted-foreground leading-none">
            {restSeconds > 0
              ? `rest ${formatRest(restSeconds)}`
              : `${minutes}m`}
            {fouls > 0 && (
              <span className={cn("ml-1", fouled && "text-destructive font-semibold")}>
                · {fouls}F
              </span>
            )}
            {ftAtt > 0 && (
              <span className="ml-1">· {ftMade}/{ftAtt}FT</span>
            )}
          </span>
        </>
      )}
    </button>
  );
});

export default BasketballPlayerToken;
