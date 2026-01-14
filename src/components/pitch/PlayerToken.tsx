import { memo, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import PositionBadge, { PitchPosition, POSITION_COLORS } from "./PositionBadge";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
}

interface PlayerTokenProps {
  player: Player;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onClick?: () => void;
  onInjuryToggle?: () => void;
  onRemoveFillIn?: () => void;
  isDragging: boolean;
  isSelected?: boolean;
  isSubTarget?: boolean;
  isInvalidTarget?: boolean;
  isMovable?: boolean;
  isPreviewHighlight?: boolean;
  previewHighlightType?: "source" | "target" | null;
  subAnimation?: "in" | "out" | null;
  variant?: "pitch" | "bench";
  style?: CSSProperties;
  readOnly?: boolean;
}

const PlayerToken = memo(function PlayerToken({
  player, 
  onDragStart, 
  onDragEnd,
  onTouchStart,
  onClick,
  onInjuryToggle,
  onRemoveFillIn,
  isDragging,
  isSelected = false,
  isSubTarget = false,
  isInvalidTarget = false,
  isMovable = false,
  isPreviewHighlight = false,
  previewHighlightType = null,
  subAnimation = null,
  variant = "pitch",
  style,
  readOnly = false
}: PlayerTokenProps) {
  const initials = player.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const currentPosColors = player.currentPitchPosition 
    ? POSITION_COLORS[player.currentPitchPosition] 
    : null;

  // Format seconds as minutes (rounded)
  const formatMinutesPlayed = (seconds?: number) => {
    if (seconds === undefined || seconds === null) return null;
    const mins = Math.floor(seconds / 60);
    return `${mins}'`;
  };

  const minutesDisplay = formatMinutesPlayed(player.minutesPlayed);

  if (variant === "bench") {
    return (
      <div
        draggable={!onClick && !readOnly && !player.isInjured}
        onDragStart={readOnly || player.isInjured ? undefined : onDragStart}
        onDragEnd={readOnly || player.isInjured ? undefined : onDragEnd}
        onTouchStart={readOnly ? undefined : onTouchStart}
        onClick={readOnly ? undefined : onClick}
        className={cn(
          "flex items-center gap-2 px-2 py-1 rounded-lg bg-muted border border-border transition-all select-none touch-none",
          !player.isInjured && "cursor-grab active:cursor-grabbing",
          player.isInjured && "opacity-60 cursor-default bg-destructive/10 border-destructive/30",
          isDragging && "opacity-50 scale-95",
          isSelected && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-background",
          isSubTarget && !isSelected && !player.isInjured && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background animate-pulse",
          isInvalidTarget && "opacity-50 ring-2 ring-destructive/50",
          subAnimation === "in" && "animate-scale-in ring-2 ring-emerald-500 bg-emerald-500/20",
          subAnimation === "out" && "animate-fade-in ring-2 ring-orange-500 bg-orange-500/20",
          onClick && !player.isInjured && "cursor-pointer"
        )}
        style={style}
      >
        <div className={cn(
          "w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary relative",
          player.isInjured && "bg-destructive/20 text-destructive",
          isSelected && "bg-yellow-400 text-yellow-900",
          isSubTarget && !isSelected && "bg-emerald-400/30 text-emerald-300",
          subAnimation === "in" && "bg-emerald-500 text-white",
          subAnimation === "out" && "bg-orange-500 text-white"
        )}>
          {player.number || initials}
          {player.isInjured && (
            <span className="absolute -top-1 -right-1 text-[8px]">🏥</span>
          )}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={cn("text-xs font-medium truncate", player.isInjured && "text-destructive")}>{player.name}</span>
            {player.isFillIn && (
              <span className="text-[9px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1 rounded">FILL-IN</span>
            )}
            {player.isInjured && (
              <span className="text-[9px] font-medium text-destructive bg-destructive/10 px-1 rounded">INJ</span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {player.assignedPositions && player.assignedPositions.length > 0 && (
              <div className="flex gap-0.5">
                {player.assignedPositions.map(pos => (
                  <PositionBadge key={pos} position={pos} size="sm" />
                ))}
              </div>
            )}
            {minutesDisplay !== null && (
              <span className="text-[10px] font-medium text-primary ml-auto">{minutesDisplay}</span>
            )}
          </div>
        </div>
        {subAnimation === "out" && (
          <span className="text-[10px] font-semibold text-orange-400 ml-auto">OFF</span>
        )}
        {onRemoveFillIn && player.isFillIn && !readOnly && player.position === null && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFillIn();
            }}
            className="ml-auto p-1 rounded-full transition-colors bg-destructive/10 hover:bg-destructive/20 text-destructive"
            title="Remove fill-in player"
          >
            <span className="text-[10px]">✕</span>
          </button>
        )}
        {onInjuryToggle && !readOnly && !player.isFillIn && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInjuryToggle();
            }}
            className={cn(
              "ml-auto p-1 rounded-full transition-colors",
              player.isInjured 
                ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-500" 
                : "bg-destructive/10 hover:bg-destructive/20 text-destructive"
            )}
            title={player.isInjured ? "Mark as fit" : "Mark as injured"}
          >
            <span className="text-[10px]">{player.isInjured ? "✓" : "🏥"}</span>
          </button>
        )}
        {onInjuryToggle && !readOnly && player.isFillIn && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInjuryToggle();
            }}
            className={cn(
              "p-1 rounded-full transition-colors",
              player.isInjured 
                ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-500" 
                : "bg-destructive/10 hover:bg-destructive/20 text-destructive"
            )}
            title={player.isInjured ? "Mark as fit" : "Mark as injured"}
          >
            <span className="text-[10px]">{player.isInjured ? "✓" : "🏥"}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      draggable={!onClick && !readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      onDragEnd={readOnly ? undefined : onDragEnd}
      onTouchStart={readOnly ? undefined : onTouchStart}
      onClick={readOnly ? undefined : onClick}
      className={cn(
        "flex flex-col items-center select-none touch-none transition-[transform,opacity] duration-300 ease-out",
        !readOnly && "cursor-grab active:cursor-grabbing",
        readOnly && "cursor-default",
        isDragging && "opacity-50 scale-95",
        isSelected && "scale-110",
        isSubTarget && !isSelected && "animate-pulse",
        isMovable && !isSelected && "animate-pulse",
        subAnimation === "in" && "animate-scale-in",
        onClick && "cursor-pointer"
      )}
      style={style}
    >
      <div className={cn(
        "w-10 h-10 rounded-full bg-background border-2 shadow-lg flex items-center justify-center text-sm font-bold relative transition-all duration-200",
        currentPosColors ? `${currentPosColors.border} ${currentPosColors.text}` : "border-primary text-primary",
        !currentPosColors && "text-foreground",
        isSelected && "border-yellow-400 ring-2 ring-yellow-400 bg-yellow-100 text-yellow-900",
        isSubTarget && !isSelected && !isInvalidTarget && "border-emerald-400 ring-2 ring-emerald-400 bg-emerald-400/20 text-emerald-700 dark:text-emerald-300",
        isInvalidTarget && !isSelected && "opacity-40 border-muted-foreground/30",
        isMovable && !isSelected && "border-amber-400 ring-2 ring-amber-400 bg-amber-400/20 text-amber-700 dark:text-amber-300",
        isPreviewHighlight && previewHighlightType === "source" && "border-orange-400 ring-4 ring-orange-400/60 bg-orange-400/30 scale-110 text-orange-700 dark:text-orange-300",
        isPreviewHighlight && previewHighlightType === "target" && "border-cyan-400 ring-4 ring-cyan-400/60 bg-cyan-400/30 scale-110 text-cyan-700 dark:text-cyan-300",
        subAnimation === "in" && "border-emerald-500 ring-4 ring-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
      )}>
        {player.number || initials}
        {subAnimation === "in" && (
          <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] font-bold px-1 rounded">ON</span>
        )}
        {isPreviewHighlight && previewHighlightType === "source" && !subAnimation && (
          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] font-bold px-1 rounded animate-pulse">OFF</span>
        )}
        {isPreviewHighlight && previewHighlightType === "target" && !subAnimation && (
          <span className="absolute -top-1 -right-1 bg-cyan-500 text-white text-[8px] font-bold px-1 rounded animate-pulse">MOVE</span>
        )}
        {player.currentPitchPosition && !subAnimation && !isPreviewHighlight && (
          <span className={cn(
            "absolute -top-1 -right-1 text-[8px] font-bold px-1 rounded",
            currentPosColors?.bg,
            currentPosColors?.text,
            "border",
            currentPosColors?.border
          )}>
            {player.currentPitchPosition}
          </span>
        )}
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[10px] font-medium bg-background/80 px-1 rounded mt-0.5 truncate max-w-16 text-foreground shadow-sm">
          {player.name.split(" ")[0]}
        </span>
        {minutesDisplay !== null && (
          <span className="text-[9px] font-medium text-primary bg-background/90 px-1.5 rounded-full border border-primary/30">
            {minutesDisplay}
          </span>
        )}
      </div>
    </div>
  );
});

export default PlayerToken;
