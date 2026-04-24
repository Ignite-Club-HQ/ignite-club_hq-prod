import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type {
  DrillObject,
  Annotation,
  ArrowGeometry,
  TextGeometry,
  StepMarkerGeometry,
  ZoneGeometry,
} from "./types";

interface DrillStepOverlayProps {
  frameNumber: number;
  totalFrames: number;
  notes: string;
  /** Preferred anchor when no auto-placement input is given. */
  anchor?: "top" | "bottom";
  /** Current frame's objects — used to auto-place the card away from players/balls/cones. */
  objects?: DrillObject[];
  /** Current frame's annotations — used so arrows/text don't get covered. */
  annotations?: Annotation[];
  /** Disable smart auto-placement (e.g. when caller wants a fixed anchor). */
  autoPlace?: boolean;
  /**
   * True while the drill is animating. We freeze auto-placement during
   * animation so the card doesn't hop between corners every interpolation
   * tick (which felt like a "shake" to coaches).
   */
  isAnimating?: boolean;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * The card occupies roughly this fraction of the pitch (0-100 coords).
 * Conservative — better to over-estimate than to clip players.
 */
const CARD_W = 50;
const CARD_H = 26;

/**
 * Approximate footprint of a drill object in pitch-% coordinates. Goals span
 * a wide horizontal area, balls/cones are small, players are mid-sized.
 */
function objectExtent(o: DrillObject): { hx: number; hy: number } {
  switch (o.type) {
    case "full-goal":
      return { hx: 14, hy: 4 };
    case "mini-goal":
      return { hx: 10, hy: 3 };
    case "player":
      return { hx: 5, hy: 5 };
    case "ball":
    case "cone":
      return { hx: 3, hy: 3 };
    default:
      return { hx: 4, hy: 4 };
  }
}

function rectsIntersect(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
): boolean {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

function pointInRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function segmentIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  rx0: number, ry0: number, rx1: number, ry1: number,
): boolean {
  if (pointInRect(x1, y1, rx0, ry0, rx1, ry1)) return true;
  if (pointInRect(x2, y2, rx0, ry0, rx1, ry1)) return true;
  // Quick AABB rejection on the segment's bounding box.
  const sx0 = Math.min(x1, x2);
  const sx1 = Math.max(x1, x2);
  const sy0 = Math.min(y1, y2);
  const sy1 = Math.max(y1, y2);
  return rectsIntersect(sx0, sy0, sx1, sy1, rx0, ry0, rx1, ry1);
}

/**
 * Score how "clear" a corner is. Lower = clearer. Penalises any drill content
 * (players, balls, cones, goals, arrows, text labels, zones) that overlaps or
 * sits near the card's rectangle so the overlay never covers play.
 */
function scoreCorner(
  corner: Corner,
  objects: DrillObject[],
  annotations: Annotation[],
): number {
  const x0 = corner.endsWith("left") ? 0 : 100 - CARD_W;
  const x1 = x0 + CARD_W;
  const y0 = corner.startsWith("top") ? 0 : 100 - CARD_H;
  const y1 = y0 + CARD_H;

  let score = 0;

  for (const o of objects) {
    const x = (o as { x?: number }).x;
    const y = (o as { y?: number }).y;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const { hx, hy } = objectExtent(o);
    const ox0 = x - hx;
    const oy0 = y - hy;
    const ox1 = x + hx;
    const oy1 = y + hy;
    if (rectsIntersect(x0, y0, x1, y1, ox0, oy0, ox1, oy1)) {
      // Goals are sacrosanct — never cover them. Use a huge penalty so the
      // overlay always prefers ANY other corner, even one that clips a player
      // chip, over hiding the goal mouth.
      score += o.type === "full-goal" || o.type === "mini-goal" ? 10000 : 150;
    } else {
      const dx = Math.max(0, x0 - ox1, ox0 - x1);
      const dy = Math.max(0, y0 - oy1, oy0 - y1);
      const d = Math.hypot(dx, dy);
      if (d < 8) score += (8 - d) * 3;
    }
  }

  for (const a of annotations) {
    if (a.type === "arrow-solid" || a.type === "arrow-dashed") {
      const g = a.geometry as ArrowGeometry;
      if (segmentIntersectsRect(g.from.x, g.from.y, g.to.x, g.to.y, x0, y0, x1, y1)) {
        score += 80;
      }
    } else if (a.type === "text") {
      const g = a.geometry as TextGeometry;
      if (pointInRect(g.x, g.y, x0 - 4, y0 - 3, x1 + 4, y1 + 3)) {
        score += 60;
      }
    } else if (a.type === "step-marker") {
      const g = a.geometry as StepMarkerGeometry;
      if (pointInRect(g.x, g.y, x0 - 2, y0 - 2, x1 + 2, y1 + 2)) {
        score += 50;
      }
    } else if (a.type === "zone") {
      const g = a.geometry as ZoneGeometry;
      if (rectsIntersect(x0, y0, x1, y1, g.x, g.y, g.x + g.width, g.y + g.height)) {
        score += 40;
      }
    }
  }

  return score;
}

/**
 * Floating, semi-transparent coaching card. Sits OVER the pitch (never blocks
 * the centre play area). Auto-places into the clearest corner so it never
 * overlaps players, balls, cones, or arrows.
 */
function DrillStepOverlayImpl({
  frameNumber,
  totalFrames,
  notes,
  anchor = "top",
  objects,
  annotations,
  autoPlace = true,
  isAnimating: _isAnimating = false,
}: DrillStepOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  // Lock auto-placement to whatever corner was chosen for this frame so that
  // mid-frame interpolation (during animation) can't bounce the card between
  // corners — that bouncing was perceived as a shake. We only re-evaluate
  // when the actual frame number changes.
  const lockedPlacementRef = useRef<Corner | null>(null);
  const lastFrameRef = useRef<number>(frameNumber);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startDx: number;
    startDy: number;
    parentRect: DOMRect;
    moved: boolean;
  } | null>(null);
  const hasNotes = !!notes?.trim();

  const placement: Corner = useMemo(() => {
    // Reuse the previously chosen corner for the duration of a single frame
    // (objects move every animation tick, but the card should stay put).
    if (lastFrameRef.current === frameNumber && lockedPlacementRef.current) {
      return lockedPlacementRef.current;
    }
    if (!autoPlace || !objects || objects.length === 0) {
      const fallback: Corner = anchor === "bottom" ? "bottom-left" : "top-left";
      lockedPlacementRef.current = fallback;
      lastFrameRef.current = frameNumber;
      return fallback;
    }
    const corners: Corner[] = anchor === "bottom"
      ? ["bottom-left", "bottom-right", "top-left", "top-right"]
      : ["top-left", "top-right", "bottom-left", "bottom-right"];

    let best: Corner = corners[0];
    let bestScore = Infinity;
    for (const c of corners) {
      const s = scoreCorner(c, objects, annotations ?? []);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    lockedPlacementRef.current = best;
    lastFrameRef.current = frameNumber;
    return best;
    // We deliberately omit `objects`/`annotations` from deps — placement is
    // evaluated once per frame to prevent shaking during animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlace, anchor, frameNumber]);

  // Reset manual drag offset only when the user moves to a different frame —
  // not on every auto-placement re-eval (that was causing the offset to
  // collapse mid-animation, which read as a sudden jump / shake).
  useEffect(() => {
    setDragOffset(null);
  }, [frameNumber]);

  const positionClass = (() => {
    switch (placement) {
      case "top-left":
        return "top-2 left-2";
      case "top-right":
        return "top-2 right-2";
      case "bottom-left":
        return "bottom-2 left-2";
      case "bottom-right":
        return "bottom-2 right-2";
    }
  })();

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const el = containerRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    e.preventDefault();
    e.stopPropagation();
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startDx: dragOffset?.dx ?? 0,
      startDy: dragOffset?.dy ?? 0,
      parentRect: parent.getBoundingClientRect(),
      moved: false,
    };
  }, [dragOffset]);

  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      const s = dragState.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (!s.moved && Math.hypot(dx, dy) < 4) return;
      s.moved = true;
      const el = containerRef.current;
      if (!el) return;
      // The element's CURRENT screen rect already reflects s.startDx/startDy
      // (the offset that was applied before this drag began). To express the
      // allowed travel as an *absolute* offset from the anchored corner we
      // need: nextOffset = startOffset + delta, clamped so the card stays
      // somewhere on the pitch. Allow ~75% of the card to slide past each
      // edge so coaches can park it almost anywhere on screen — only a thin
      // grip strip needs to stay reachable.
      const elRect = el.getBoundingClientRect();
      const overflowX = elRect.width * 0.75;
      const overflowY = elRect.height * 0.75;
      const minScreenLeft = s.parentRect.left - overflowX;
      const maxScreenLeft = s.parentRect.right - elRect.width + overflowX;
      const minScreenTop = s.parentRect.top - overflowY;
      const maxScreenTop = s.parentRect.bottom - elRect.height + overflowY;
      // Current anchored screen position (with the existing offset removed).
      const anchoredLeft = elRect.left - s.startDx;
      const anchoredTop = elRect.top - s.startDy;
      const minDx = minScreenLeft - anchoredLeft;
      const maxDx = maxScreenLeft - anchoredLeft;
      const minDy = minScreenTop - anchoredTop;
      const maxDy = maxScreenTop - anchoredTop;
      const nextDx = Math.min(Math.max(s.startDx + dx, minDx), maxDx);
      const nextDy = Math.min(Math.max(s.startDy + dy, minDy), maxDy);
      setDragOffset({ dx: nextDx, dy: nextDy });
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      const s = dragState.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const moved = s.moved;
      dragState.current = null;
      if (!moved && hasNotes) {
        setExpanded((v) => !v);
      }
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
  }, [hasNotes]);

  return (
    <div
      ref={containerRef}
      className={cn(
        // ~40% of pitch width on phones, narrower on larger screens.
        "absolute z-[60] pointer-events-auto max-w-[60%] sm:max-w-[40%] animate-fade-in",
        // Only animate corner snapping when the user isn't dragging.
        !dragOffset && "transition-[top,bottom,left,right] duration-300 ease-out",
        positionClass,
      )}
      style={
        dragOffset
          ? {
              transform: `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)`,
              willChange: "transform",
            }
          : undefined
      }
    >
      <button
        type="button"
        onPointerDown={handlePointerDown}
        className={cn(
          // NOTE: deliberately NO backdrop-blur — that re-samples the pitch
          // every animation frame, causing visible jitter while dragging.
          // A slightly more opaque solid bg + text-shadow keeps legibility.
          "w-full text-left rounded-lg border border-white/15 shadow-lg",
          "bg-black/80 text-white px-3 py-2 transition-colors touch-none select-none",
          "[text-shadow:0_1px_2px_rgba(0,0,0,0.6)]",
          hasNotes ? "hover:bg-black/85 active:bg-black/90 cursor-grab active:cursor-grabbing" : "cursor-grab active:cursor-grabbing"
        )}
        aria-expanded={expanded}
        aria-label="Drill step instructions — drag to move"
      >
        <div className="flex items-center gap-2 mb-0.5">
          <GripVertical className="h-3.5 w-3.5 text-white/50 -ml-1" />
          <span className="inline-flex items-center justify-center h-5 px-2 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
            Step {frameNumber} of {totalFrames}
          </span>
          {hasNotes && (
            <span className="ml-auto text-white/60">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          )}
        </div>
        <p
          className={cn(
            "text-[13px] leading-snug",
            !expanded && "line-clamp-2",
            !hasNotes && "italic text-white/70"
          )}
        >
          {hasNotes ? notes : "No coaching notes for this step."}
        </p>
      </button>
    </div>
  );
}

export const DrillStepOverlay = memo(DrillStepOverlayImpl);
export default DrillStepOverlay;
