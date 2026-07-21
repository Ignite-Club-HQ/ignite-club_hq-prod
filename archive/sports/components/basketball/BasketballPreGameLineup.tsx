import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  POSITION_SLOTS,
  POSITION_COLORS,
} from "./types";
import BasketballCourt from "./BasketballCourt";
import { findPlayerInPosition } from "./basketballHelpers";

interface BasketballPreGameLineupProps {
  players: BasketballPlayer[];
  bench: BasketballPlayer[];
  onAssign: (playerId: string, position: BasketballPosition | null) => void;
  readOnly?: boolean;
}

interface DragState {
  playerId: string;
  player: BasketballPlayer;
  x: number;
  y: number;
  /** "court" if dragged from a court slot; "bench" if from the bench drawer. */
  source: "court" | "bench";
}

/**
 * Drag-first pre-game lineup picker.
 * - Court fills the top of the screen (primary surface).
 * - Bench is a horizontally scrollable drag source below.
 * - Pointer Events drive a custom drag layer (touch-friendly, no HTML5 DnD
 *   weirdness on mobile).
 * - Drop on slot → assignToPosition. Drop on bench → return to bench.
 */
export default function BasketballPreGameLineup({
  players,
  bench,
  onAssign,
  readOnly = false,
}: BasketballPreGameLineupProps) {
  const courtWrapRef = useRef<HTMLDivElement>(null);
  const benchRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Map<BasketballPosition, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverPos, setHoverPos] = useState<BasketballPosition | null>(null);
  const [overBench, setOverBench] = useState(false);
  const [justPlaced, setJustPlaced] = useState<BasketballPosition | null>(null);

  const startDrag = useCallback(
    (player: BasketballPlayer, source: "court" | "bench", clientX: number, clientY: number) => {
      if (readOnly) return;
      setDrag({ playerId: player.id, player, x: clientX, y: clientY, source });
    },
    [readOnly]
  );

  // Pointer move + up — global so the drag layer follows even when leaving the source.
  useEffect(() => {
    if (!drag) return;

    const findHover = (x: number, y: number) => {
      let foundSlot: BasketballPosition | null = null;
      let nearestDist = Infinity;
      for (const pos of BASKETBALL_POSITIONS) {
        const el = slotRefs.current.get(pos);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        // Direct hit: pointer inside the slot rect.
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          foundSlot = pos;
          nearestDist = 0;
          break;
        }
        // Otherwise track nearest within snap radius.
        if (dist < nearestDist) {
          nearestDist = dist;
          if (dist < 60) foundSlot = pos;
        }
      }
      const benchEl = benchRef.current;
      const inBench = benchEl
        ? (() => {
            const r = benchEl.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })()
        : false;
      // Bench hover only matters for court→bench drags and beats slot detection
      // when pointer is clearly inside the bench area.
      setHoverPos(inBench ? null : foundSlot);
      setOverBench(inBench);
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
      findHover(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      // Recompute hover once more in case move events were throttled.
      let dropPos: BasketballPosition | null = null;
      let nearestDist = Infinity;
      for (const pos of BASKETBALL_POSITIONS) {
        const el = slotRefs.current.get(pos);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const dist = Math.hypot(x - cx, y - cy);
        if (inside) {
          dropPos = pos;
          break;
        }
        if (dist < nearestDist && dist < 60) {
          nearestDist = dist;
          dropPos = pos;
        }
      }
      const benchEl = benchRef.current;
      const droppedOnBench = benchEl
        ? (() => {
            const r = benchEl.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })()
        : false;

      if (drag) {
        if (dropPos && !droppedOnBench) {
          onAssign(drag.playerId, dropPos);
          setJustPlaced(dropPos);
          window.setTimeout(() => setJustPlaced(null), 400);
        } else if (droppedOnBench && drag.source === "court") {
          onAssign(drag.playerId, null);
        }
      }

      setDrag(null);
      setHoverPos(null);
      setOverBench(false);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, onAssign]);

  const onCourtCount = players.filter((p) => p.position !== null).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      {/* COURT — primary surface */}
      <div
        ref={courtWrapRef}
        className="relative flex-1 min-h-0 flex items-center justify-center bg-pitch-green/10 px-2 pt-1 pb-2"
      >
        <div className="relative h-full max-h-full aspect-[5/7] mx-auto" style={{ maxWidth: "100%" }}>
          <BasketballCourt className="absolute inset-0 w-full h-full rounded-lg" />

          {BASKETBALL_POSITIONS.map((pos) => {
            const slot = POSITION_SLOTS[pos];
            const player = findPlayerInPosition(players, pos);
            const colors = POSITION_COLORS[pos];
            const isHover = hoverPos === pos;
            const justSnapped = justPlaced === pos;

            return (
              <div
                key={pos}
                ref={(el) => {
                  if (el) slotRefs.current.set(pos, el);
                  else slotRefs.current.delete(pos);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                {player ? (
                  <CourtToken
                    player={player}
                    position={pos}
                    isDragging={drag?.playerId === player.id}
                    isHover={isHover}
                    justSnapped={justSnapped}
                    readOnly={readOnly}
                    onPointerDown={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      startDrag(player, "court", e.clientX, e.clientY);
                    }}
                  />
                ) : (
                  <EmptySlot
                    position={pos}
                    colors={colors}
                    isHover={isHover}
                    isDragging={!!drag}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* BENCH — drag source */}
      <div
        ref={benchRef}
        className={cn(
          "border-t bg-card transition-colors",
          overBench && drag?.source === "court" && "bg-primary/10"
        )}
      >
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <h3 className="text-xs font-bold tabular-nums">
            Bench · {bench.length}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {onCourtCount} / 5 on court · drag to place
          </span>
        </div>
        {bench.length === 0 ? (
          <div className="px-3 pb-3 text-[11px] text-muted-foreground italic">
            All players are on the court.
          </div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain pb-3 pt-1">
            <div className="flex gap-2 px-3 min-w-min">
              {bench.map((p) => (
                <BenchChip
                  key={p.id}
                  player={p}
                  isDragging={drag?.playerId === p.id}
                  readOnly={readOnly}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    startDrag(p, "bench", e.clientX, e.clientY);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* DRAG GHOST — follows pointer */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2"
          style={{ left: drag.x, top: drag.y }}
        >
          <DragGhost player={drag.player} />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function CourtToken({
  player,
  position,
  isDragging,
  isHover,
  justSnapped,
  readOnly,
  onPointerDown,
}: {
  player: BasketballPlayer;
  position: BasketballPosition;
  isDragging: boolean;
  isHover: boolean;
  justSnapped: boolean;
  readOnly: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const colors = POSITION_COLORS[position];
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "relative flex flex-col items-center gap-0.5 touch-none cursor-grab active:cursor-grabbing transition-transform",
        isDragging && "opacity-30 scale-95",
        isHover && "scale-110",
        justSnapped && "animate-scale-in",
        readOnly && "pointer-events-none"
      )}
    >
      <Avatar
        className={cn(
          "h-12 w-12 border-2 shadow-md",
          colors.border,
          justSnapped && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <AvatarFallback className={cn("text-xs font-bold", colors.bg, colors.text)}>
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "text-[9px] font-bold rounded px-1 border leading-none py-0.5",
          colors.bg,
          colors.text,
          colors.border
        )}
      >
        {position}
      </span>
      <span className="text-[10px] font-medium text-foreground/90 leading-tight max-w-[64px] truncate">
        {player.name.split(" ")[0]}
      </span>
    </div>
  );
}

function EmptySlot({
  position,
  colors,
  isHover,
  isDragging,
}: {
  position: BasketballPosition;
  colors: { bg: string; text: string; border: string };
  isHover: boolean;
  isDragging: boolean;
}) {
  return (
    <div
      className={cn(
        "w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center text-[11px] font-bold transition-all",
        isHover
          ? "border-primary bg-primary/20 text-primary scale-125 shadow-lg"
          : isDragging
          ? "border-primary/60 text-primary animate-pulse"
          : "border-white/60 text-white/80 animate-pulse"
      )}
      aria-label={`Empty ${position} slot`}
    >
      {position}
    </div>
  );
}

function BenchChip({
  player,
  isDragging,
  readOnly,
  onPointerDown,
}: {
  player: BasketballPlayer;
  isDragging: boolean;
  readOnly: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "flex flex-col items-center gap-1 shrink-0 touch-none cursor-grab active:cursor-grabbing rounded-lg p-1.5 bg-muted/40 border border-border min-w-[60px] transition-transform",
        isDragging && "opacity-30 scale-95",
        readOnly && "pointer-events-none opacity-60"
      )}
    >
      <Avatar className="h-11 w-11 border-2 border-border shadow-sm">
        <AvatarFallback className="text-xs font-bold bg-muted text-foreground">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-[10px] font-medium leading-tight max-w-[64px] truncate">
        {player.name.split(" ")[0]}
      </span>
    </div>
  );
}

function DragGhost({ player }: { player: BasketballPlayer }) {
  const colors = player.position ? POSITION_COLORS[player.position] : null;
  return (
    <div className="flex flex-col items-center gap-0.5 scale-110 drop-shadow-2xl">
      <Avatar className={cn("h-14 w-14 border-2 shadow-2xl", colors?.border ?? "border-primary")}>
        <AvatarFallback className={cn("text-sm font-bold", colors?.bg ?? "bg-primary/30", colors?.text ?? "text-primary")}>
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-[10px] font-bold bg-background/90 px-1.5 py-0.5 rounded border border-border">
        {player.name.split(" ")[0]}
      </span>
    </div>
  );
}
