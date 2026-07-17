import { memo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NetballPlayer, NetballPosition } from "./types";
import { Pin, AlertTriangle } from "lucide-react";
import { useNowTick, formatRest } from "@/hooks/useNowTick";

/**
 * Netball player token — restyled to mirror BasketballPlayerToken.
 *
 * Solid, high-contrast position colours; glossy avatar with strong shadow;
 * bottom-attached position pill; on-court tokens get a compact name chip
 * (minutes only surfaced once they've actually played time, so the default
 * board reads as a clean coaching surface — no "0m" noise).
 */

const POSITION_TOKEN_COLORS: Record<NetballPosition, { bg: string; text: string; border: string }> = {
  GS: { bg: "bg-red-600",     text: "text-white", border: "border-red-300" },
  GA: { bg: "bg-orange-600",  text: "text-white", border: "border-orange-300" },
  WA: { bg: "bg-amber-600",   text: "text-white", border: "border-amber-300" },
  C:  { bg: "bg-emerald-600", text: "text-white", border: "border-emerald-300" },
  WD: { bg: "bg-sky-600",     text: "text-white", border: "border-sky-300" },
  GD: { bg: "bg-indigo-600",  text: "text-white", border: "border-indigo-300" },
  GK: { bg: "bg-violet-600",  text: "text-white", border: "border-violet-300" },
};

interface NetballPlayerTokenProps {
  player: NetballPlayer;
  position?: NetballPosition;
  variant?: "court" | "bench";
  isSelected?: boolean;
  isSwapTarget?: boolean;
  isInvalidTarget?: boolean;
  /** When true, dims this token so the user's eye is drawn to swap targets. */
  isDimmed?: boolean;
  /** Briefly glows the token after a recent swap. */
  isRecentlySwapped?: boolean;
  isDragging?: boolean;
  isNextSub?: boolean;
  isLowestMinutes?: boolean;
  onClick?: () => void;
  /** Long-press (~500ms) opens the quick action sheet. Tap = direct sub-mode. */
  onLongPress?: () => void;
  /** Native HTML5 drag — used by the live court for swaps. */
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  readOnly?: boolean;
  style?: React.CSSProperties;
  /** Hides the minutes/rest label entirely (used while live game just started). */
  hideStats?: boolean;
}

/**
 * Strip developer noise like "Mock " or "Mock Player" prefixes from the
 * displayed name so the live board never shows scaffolding text.
 */
const cleanName = (raw: string): string =>
  raw.replace(/^mock\s+/i, "").replace(/^mock player\s*/i, "Player ").trim() || raw;

const NetballPlayerToken = memo(function NetballPlayerToken({
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
  onClick,
  onLongPress,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onTouchStart,
  readOnly = false,
  style,
  hideStats = false,
}: NetballPlayerTokenProps) {
  // Long-press detection — 500ms hold opens the quick action sheet.
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
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onClick?.();
  };

  const displayName = cleanName(player.name);
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const pos = position ?? player.position;
  const colors = pos ? POSITION_TOKEN_COLORS[pos] : null;
  const minutes = Math.floor((player.minutesPlayed ?? 0) / 60);
  const goals = player.goals ?? 0;
  const now = useNowTick(5000);
  const restSeconds =
    variant === "bench" && player.lastBenchedAt
      ? Math.max(0, Math.floor((now - player.lastBenchedAt) / 1000))
      : 0;
  // Default-hide "0m" so a fresh game reads cleanly. Only show stats once
  // the player has actually played time or accumulated rest seconds.
  const showStats =
    !hideStats && (minutes > 0 || restSeconds > 0 || (player.minutesPlayed ?? 0) > 0);

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
      onDragOver={onDragOver}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      data-player-id={player.id}
      style={style}
      aria-label={`${displayName}${pos ? ` at ${pos}` : " on bench"}${goals > 0 ? `, ${goals} goals` : ""}`}
      className={cn(
        "relative flex flex-col items-center gap-0 touch-manipulation select-none",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
        "active:scale-[0.92] active:duration-75",
        variant === "court" ? "w-16" : "w-12",
        isDragging && "opacity-40 scale-90",
        isSelected &&
          "scale-110 z-20 drop-shadow-[0_0_16px_hsl(var(--primary)/0.75)] ring-2 ring-primary ring-offset-2 ring-offset-background rounded-full",
        isSwapTarget && !isInvalidTarget &&
          "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background rounded-full animate-pulse",
        isInvalidTarget &&
          "ring-2 ring-destructive ring-offset-2 ring-offset-background rounded-full opacity-70 animate-shake-x",
        isDimmed && !isSelected && !isSwapTarget && "opacity-40",
        isRecentlySwapped && "drop-shadow-[0_0_16px_hsl(var(--primary)/0.85)] animate-fade-in",
        isNextSub && !isSelected && variant === "court" &&
          "ring-2 ring-orange-400 ring-offset-2 ring-offset-background rounded-full animate-pulse drop-shadow-[0_0_12px_rgba(251,146,60,0.7)]",
        readOnly && "pointer-events-none",
      )}
    >
      {/* Status badges */}
      {player.isInjured ? (
        <span
          className="absolute -top-1 -right-1 z-10 bg-destructive text-destructive-foreground rounded-full p-0.5"
          title="Injured"
        >
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
      {/* Bench-side subtle dot indicators (no text labels) */}
      {variant === "bench" && !isSelected && isNextSub && (
        <span
          className="absolute -top-1 right-0 z-20 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background shadow-[0_0_8px_hsl(142_72%_45%/0.7)]"
          aria-label="Next sub in"
        />
      )}
      {variant === "bench" && !isSelected && !isNextSub && isLowestMinutes && (
        <span
          className="absolute -top-1 right-0 z-20 h-2 w-2 rounded-full bg-muted-foreground/60 ring-2 ring-background"
          aria-label="Most rested"
        />
      )}

      <div className="relative">
        <Avatar
          className={cn(
            "shadow-[0_3px_8px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.25)] transition-shadow",
            "ring-2 ring-black/30",
            variant === "court" ? "h-13 w-13 border-[3px]" : "h-10 w-10 border-2",
            colors?.border ?? "border-border",
          )}
          style={variant === "court" ? { height: "3.25rem", width: "3.25rem" } : undefined}
        >
          <AvatarFallback
            className={cn(
              "font-extrabold relative",
              variant === "court" ? "text-sm" : "text-xs",
              colors?.bg,
              colors?.text,
              "before:absolute before:inset-0 before:rounded-full before:pointer-events-none",
              "before:bg-[linear-gradient(180deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_55%)]",
            )}
          >
            <span className="relative z-10">
              {player.number !== undefined ? player.number : initials}
            </span>
          </AvatarFallback>
        </Avatar>
        {pos && (
          <span
            className={cn(
              "absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-20 text-[9px] font-bold rounded px-1.5 py-px border shadow-sm leading-none",
              colors?.bg,
              colors?.text,
              colors?.border,
            )}
          >
            {pos}
          </span>
        )}
        {goals > 0 && (
          <span
            className="absolute -bottom-1 -right-1 z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm ring-1 ring-background"
            aria-hidden
          >
            {goals}
          </span>
        )}
      </div>

      {/* Label — on-court players get a slim chip; bench gets stacked text.
          Minutes are suppressed by default (e.g. fresh game) so the board
          isn't cluttered with "0m" everywhere. */}
      {variant === "court" ? (
        <span
          className={cn(
            "mt-1.5 inline-flex items-center justify-center gap-1 px-1.5 py-px rounded-md",
            "bg-background/95 border border-border/70 shadow-[0_1px_2px_rgba(0,0,0,0.18)]",
            "text-[10px] leading-none min-w-[2.75rem] max-w-[78px]",
          )}
        >
          <span className="truncate font-bold tracking-tight text-foreground">
            {displayName.split(" ")[0]}
          </span>
          {showStats && (
            <span className="tabular-nums font-normal text-muted-foreground/80 text-[9px]">{`${minutes}m`}</span>
          )}
        </span>
      ) : (
        <>
          <span className="mt-1 text-[10.5px] font-semibold text-foreground leading-tight text-center max-w-full truncate">
            {displayName.split(" ")[0]}
          </span>
          {showStats && (
            <span className="mt-0.5 text-[9px] text-muted-foreground/70 leading-none tabular-nums font-normal">
              {restSeconds > 0 ? formatRest(restSeconds) : `${minutes}m`}
            </span>
          )}
        </>
      )}
    </button>
  );
});

export default NetballPlayerToken;
