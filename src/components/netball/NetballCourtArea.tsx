import { cn } from "@/lib/utils";
import { ZoomIn } from "lucide-react";
import { useState } from "react";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_SLOTS,
} from "./types";
import NetballCourt from "./NetballCourt";
import NetballPlayerToken from "./NetballPlayerToken";
import { findPlayerInPosition, isPositionAllowedForPlayer } from "./netballHelpers";
import { usePinchZoom } from "@/hooks/usePinchZoom";

interface NetballCourtAreaProps {
  players: NetballPlayer[];
  selectedPlayerId: string | null;
  /** True when the selected player is on the bench — court tokens become swap targets. */
  selectedIsOnBench?: boolean;
  nextSubOutId?: string | null;
  recentlySwappedIds?: string[];
  readOnly?: boolean;
  /** When true, empty position slots render nothing (used in live mode). */
  hideEmptySlots?: boolean;
  onPlayerClick: (playerId: string) => void;
  /** Long-press a player to open the quick action sheet. */
  onPlayerLongPress?: (playerId: string) => void;
  onSlotClick: (position: NetballPosition) => void;
  /** Drag-drop swap: when a token is dropped onto another player or slot,
   *  this fires with the source + target ids (target may be a position string). */
  onDragSwap?: (sourceId: string, targetId: string) => void;
  /** Drag-drop sub: drop a player onto an empty position slot. */
  onDragToSlot?: (sourceId: string, position: NetballPosition) => void;
}

/**
 * Renders the netball court SVG with the 7 fixed position slots.
 *
 * Drag & drop: tokens are HTML5-draggable (already on the token); this
 * component wires the drop handlers so a coach can grab a court player and
 * drop onto another court player (swap), or onto an empty slot (move).
 * Cross-bench drops are wired the same way at the bench layer.
 */
export default function NetballCourtArea({
  players,
  selectedPlayerId,
  selectedIsOnBench = false,
  nextSubOutId,
  recentlySwappedIds = [],
  readOnly = false,
  hideEmptySlots = false,
  onPlayerClick,
  onPlayerLongPress,
  onSlotClick,
  onDragSwap,
  onDragToSlot,
}: NetballCourtAreaProps) {
  const selectedPlayer = selectedPlayerId
    ? players.find((p) => p.id === selectedPlayerId) ?? null
    : null;

  const {
    scale,
    translateX,
    translateY,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    resetZoom,
  } = usePinchZoom(1, 4);

  const isZoomed = scale > 1.01;

  // Track the player currently being dragged so we can highlight valid drop
  // zones across the court while the drag is in flight.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingPlayer = draggingId ? players.find((p) => p.id === draggingId) ?? null : null;

  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center bg-muted/40 px-1 py-1 overflow-hidden">
      {/* Width derived from available height so the whole court is always visible.
          Aspect 5/7 mirrors basketball half-court so HUD docking is consistent. */}
      <div
        className="relative h-full max-h-full mx-auto touch-none select-none aspect-[5/7]"
        style={{
          maxWidth: "100%",
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
          transformOrigin: "center center",
          transition: isZoomed ? "none" : "transform 0.2s ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <NetballCourt className="absolute inset-0 w-full h-full rounded-lg" />

        {NETBALL_POSITIONS.map((pos) => {
          const slot = POSITION_SLOTS[pos];
          const player = findPlayerInPosition(players, pos);
          // Drag-aware highlight: while dragging a player, every slot they
          // could land on (and every other player) becomes a valid target.
          const dragActiveOnPos = draggingPlayer
            ? isPositionAllowedForPlayer(draggingPlayer, pos)
            : true;
          // Only enforce position validity visually when subbing in from bench.
          const positionAllowed = selectedPlayer
            ? isPositionAllowedForPlayer(selectedPlayer, pos)
            : true;
          return (
            <div
              key={pos}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              {player ? (
                <NetballPlayerToken
                  player={player}
                  position={pos}
                  variant="court"
                  isSelected={selectedPlayerId === player.id}
                  isDragging={draggingId === player.id}
                  // Court tokens are swap targets in two scenarios, mirroring basketball:
                  //  1. Selected player is on bench → substitution
                  //  2. Selected player is on court → position swap
                  // Or while a drag is in flight from any other player.
                  isSwapTarget={
                    (!!selectedPlayerId && selectedPlayerId !== player.id) ||
                    (!!draggingId && draggingId !== player.id)
                  }
                  isInvalidTarget={
                    !!selectedPlayer &&
                    selectedPlayerId !== player.id &&
                    selectedIsOnBench &&
                    !positionAllowed
                  }
                  isRecentlySwapped={recentlySwappedIds.includes(player.id)}
                  isNextSub={nextSubOutId === player.id}
                  onClick={() => onPlayerClick(player.id)}
                  onLongPress={
                    onPlayerLongPress ? () => onPlayerLongPress(player.id) : undefined
                  }
                  onDragStart={(e) => {
                    if (readOnly) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", player.id);
                    setDraggingId(player.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(e) => {
                    if (!draggingId || draggingId === player.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (!draggingId || draggingId === player.id) return;
                    e.preventDefault();
                    onDragSwap?.(draggingId, player.id);
                    setDraggingId(null);
                  }}
                  readOnly={readOnly}
                />
              ) : hideEmptySlots ? (
                // Even with no visible chrome, keep an invisible drop target so
                // a dragged player can land on an unoccupied position.
                draggingId ? (
                  <div
                    onDragOver={(e) => {
                      if (!dragActiveOnPos) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      if (!draggingId) return;
                      e.preventDefault();
                      onDragToSlot?.(draggingId, pos);
                      setDraggingId(null);
                    }}
                    className={cn(
                      "w-14 h-14 rounded-full border-2 border-dashed transition",
                      dragActiveOnPos
                        ? "border-emerald-400 bg-emerald-400/15 animate-pulse"
                        : "border-destructive/60 bg-destructive/10 opacity-60",
                    )}
                    aria-label={`Drop here to take ${pos}`}
                  />
                ) : null
              ) : (
                <button
                  type="button"
                  onClick={() => onSlotClick(pos)}
                  onDragOver={(e) => {
                    if (!draggingId || !dragActiveOnPos) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (!draggingId) return;
                    e.preventDefault();
                    onDragToSlot?.(draggingId, pos);
                    setDraggingId(null);
                  }}
                  className={cn(
                    "w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] font-bold transition",
                    selectedPlayerId || draggingId
                      ? (selectedPlayerId ? positionAllowed : dragActiveOnPos)
                        ? "border-emerald-400 bg-emerald-400/15 text-emerald-50 animate-pulse"
                        : "border-destructive/60 bg-destructive/10 text-destructive-foreground/80 opacity-70"
                      : "border-white/40 text-white/70 hover:border-white/80",
                  )}
                  aria-label={`Empty ${pos} slot`}
                >
                  {pos}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isZoomed && (
        <button
          type="button"
          onClick={resetZoom}
          className="absolute top-2 right-2 z-10 h-8 px-2 rounded-md bg-background/90 backdrop-blur border border-border text-xs font-medium text-foreground shadow-md flex items-center gap-1 active:scale-95 transition"
          aria-label="Reset zoom"
        >
          <ZoomIn className="h-3.5 w-3.5" />
          {scale.toFixed(1)}× · Reset
        </button>
      )}
    </div>
  );
}
