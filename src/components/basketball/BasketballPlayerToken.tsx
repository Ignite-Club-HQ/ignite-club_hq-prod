import { memo } from "react";
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
  isDragging?: boolean;
  isNextSub?: boolean;
  isLowestMinutes?: boolean;
  onClick?: () => void;
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
  isDragging = false,
  isNextSub = false,
  isLowestMinutes = false,
  onClick,
  onDragStart,
  onDragEnd,
  onTouchStart,
  readOnly = false,
  style,
}: BasketballPlayerTokenProps) {
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
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      style={style}
      aria-label={`${player.name}${pos ? ` at ${pos}` : " on bench"}${points > 0 ? `, ${points} points` : ""}`}
      className={cn(
        "relative flex flex-col items-center gap-1 touch-manipulation select-none",
        "transition-all duration-200 ease-out will-change-transform",
        variant === "court" ? "w-14" : "w-12",
        isDragging && "opacity-40 scale-90",
        isSelected && "scale-110 z-20 drop-shadow-[0_0_12px_hsl(var(--primary)/0.6)]",
        isSwapTarget && "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-full animate-pulse",
        isInvalidTarget && "ring-2 ring-destructive ring-offset-2 ring-offset-background rounded-full",
        isNextSub && "animate-pulse drop-shadow-[0_0_8px_hsl(var(--primary)/0.45)]",
        isLowestMinutes && variant === "bench" && "ring-2 ring-emerald-500 ring-offset-1 ring-offset-background rounded-full",
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
            "border-2 shadow-md transition-shadow",
            "drop-shadow-[0_2px_4px_hsl(var(--foreground)/0.18)]",
            variant === "court" ? "h-11 w-11" : "h-10 w-10",
            fouled ? "border-destructive opacity-70" : (colors?.border ?? "border-border")
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
        {points > 0 && (
          <span
            className="absolute -bottom-1 -right-1 z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm"
            aria-hidden
          >
            {points}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium text-foreground/90 leading-tight text-center max-w-full truncate">
        {player.name.split(" ")[0]}
      </span>
      <span className="text-[9px] text-muted-foreground leading-none">
        {variant === "bench" && restSeconds > 0
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
    </button>
  );
});

export default BasketballPlayerToken;
