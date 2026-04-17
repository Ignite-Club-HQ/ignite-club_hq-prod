import { memo } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NetballPlayer, NetballPosition, POSITION_COLORS } from "./types";
import { Pin, AlertTriangle } from "lucide-react";

interface NetballPlayerTokenProps {
  player: NetballPlayer;
  position?: NetballPosition;
  variant?: "court" | "bench";
  isSelected?: boolean;
  isSwapTarget?: boolean;
  isInvalidTarget?: boolean;
  isDragging?: boolean;
  isNextSub?: boolean;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  readOnly?: boolean;
  style?: React.CSSProperties;
}

const NetballPlayerToken = memo(function NetballPlayerToken({
  player,
  position,
  variant = "court",
  isSelected = false,
  isSwapTarget = false,
  isInvalidTarget = false,
  isDragging = false,
  isNextSub = false,
  onClick,
  onDragStart,
  onDragEnd,
  onTouchStart,
  readOnly = false,
  style,
}: NetballPlayerTokenProps) {
  const initials = player.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const pos = position ?? player.position;
  const colors = pos ? POSITION_COLORS[pos] : null;
  const minutes = Math.floor((player.minutesPlayed ?? 0) / 60);

  return (
    <button
      type="button"
      draggable={!readOnly}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      style={style}
      aria-label={`${player.name}${pos ? ` at ${pos}` : " on bench"}`}
      className={cn(
        "relative flex flex-col items-center gap-1 transition-all touch-manipulation select-none",
        variant === "court" ? "w-14" : "w-12",
        isDragging && "opacity-40 scale-90",
        isSelected && "scale-110 z-20",
        isSwapTarget && "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-full",
        isInvalidTarget && "ring-2 ring-destructive ring-offset-2 ring-offset-background rounded-full",
        isNextSub && "animate-pulse",
        readOnly && "pointer-events-none"
      )}
    >
      {player.isInjured && (
        <span className="absolute -top-1 -right-1 z-10 bg-destructive text-destructive-foreground rounded-full p-0.5">
          <AlertTriangle className="h-3 w-3" />
        </span>
      )}
      {player.isFillIn && (
        <span className="absolute -top-1 -left-1 z-10 bg-amber-500 text-white rounded-full p-0.5">
          <Pin className="h-3 w-3" />
        </span>
      )}
      {player.number !== undefined && (
        <span
          className={cn(
            "absolute -top-1 -left-1 z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-background border border-border text-[10px] font-bold text-foreground shadow-sm",
            player.isFillIn && "left-auto -right-1"
          )}
          aria-hidden
        >
          {player.number}
        </span>
      )}
      <div className="relative">
        <Avatar
          className={cn(
            "border-2 shadow-md",
            variant === "court" ? "h-11 w-11" : "h-10 w-10",
            colors?.border ?? "border-border"
          )}
        >
          <AvatarFallback className={cn("text-xs font-bold", colors?.bg, colors?.text)}>
            {initials}
          </AvatarFallback>
        </Avatar>
        {pos && (
          <span
            className={cn(
              "absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold rounded px-1 border",
              colors?.bg,
              colors?.text,
              colors?.border
            )}
          >
            {pos}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium text-foreground/90 leading-tight text-center max-w-full truncate">
        {player.name.split(" ")[0]}
      </span>
      <span className="text-[9px] text-muted-foreground leading-none">{minutes}m</span>
    </button>
  );
});

export default NetballPlayerToken;
