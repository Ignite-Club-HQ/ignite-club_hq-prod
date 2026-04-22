import { memo, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DrillObject, Annotation } from "./types";

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
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * The card occupies roughly this fraction of the pitch (0-100 coords).
 * Conservative — better to over-estimate than to clip players.
 */
const CARD_W = 46;
const CARD_H = 22;

/**
 * Score how "clear" a corner is by summing inverse-distance penalties from any
 * drill content that falls inside the corner's rectangle. Lower score = clearer.
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
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      // Player inside the card area — heavy penalty
      score += 100;
    } else {
      // Soft penalty for being near the edge of the card
      const dx = Math.max(0, x0 - x, x - x1);
      const dy = Math.max(0, y0 - y, y - y1);
      const d = Math.hypot(dx, dy);
      if (d < 8) score += (8 - d) * 2;
    }
  }

  for (const a of annotations) {
    const pts = (a as { points?: { x: number; y: number }[] }).points;
    if (!pts) continue;
    for (const p of pts) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
        score += 30;
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
}: DrillStepOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const hasNotes = !!notes?.trim();

  const placement: Corner = useMemo(() => {
    if (!autoPlace || !objects || objects.length === 0) {
      return anchor === "bottom" ? "bottom-left" : "top-left";
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
    return best;
  }, [autoPlace, objects, annotations, anchor]);

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

  return (
    <div
      className={cn(
        "absolute z-[60] pointer-events-auto max-w-[78%] sm:max-w-[46%] transition-[top,bottom,left,right] duration-300 ease-out",
        positionClass,
      )}
    >
      <button
        type="button"
        onClick={() => hasNotes && setExpanded((e) => !e)}
        className={cn(
          "w-full text-left rounded-lg backdrop-blur-md border border-white/15 shadow-lg",
          "bg-black/65 text-white px-3 py-2 transition-colors",
          hasNotes ? "hover:bg-black/75 active:bg-black/80 cursor-pointer" : "cursor-default"
        )}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 mb-0.5">
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
