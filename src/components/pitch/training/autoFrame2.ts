// Auto-generates a "frame 2" for a drill from its first frame.
// Strategy:
//   1. For each movable object (player or ball), find the nearest arrow whose
//      "from" endpoint sits on top of the object (within a small radius).
//   2. Move the object to that arrow's "to" endpoint.
//   3. If the object has no anchored arrow, it stays still — coaches can
//      reposition manually after generation.
//   4. Static items (cones, goals) never move. Annotations are kept identical
//      so the arrows still illustrate the path on the new frame.
//
// This mirrors the manual motion table in scripts/seed-drill-frame2.ts but is
// generic — driven entirely by the arrows the coach drew on frame 1.

import type {
  Annotation,
  ArrowGeometry,
  DrillFrame,
  DrillObject,
} from "./types";

/** Arrow endpoints within this many percentage points are treated as "on" the object. */
const ANCHOR_RADIUS = 7;

const MOVABLE_TYPES: ReadonlySet<string> = new Set(["player", "ball"]);

const isArrow = (a: Annotation): a is Annotation & { geometry: ArrowGeometry } =>
  a.type === "arrow-solid" || a.type === "arrow-dashed";

function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface AutoFrameResult {
  frame: DrillFrame;
  movedCount: number;
  /** Object ids that found an arrow and were moved. */
  movedIds: string[];
}

/**
 * Build a new DrillFrame (position 1) by moving objects along their anchored
 * arrows. Throws if `frame1` has no objects at all.
 */
export function generateFrame2(frame1: DrillFrame, durationMs = 1500): AutoFrameResult {
  if (!frame1?.objects?.length) {
    throw new Error("Cannot auto-generate: frame 1 has no objects.");
  }

  const arrows = (frame1.annotations ?? []).filter(isArrow);
  const movedIds: string[] = [];

  // Greedy assignment: each arrow can only move one object (its closest match)
  // so two players sharing one arrow don't collapse onto the same point.
  const usedArrowIds = new Set<string>();

  const newObjects: DrillObject[] = frame1.objects.map((obj) => {
    if (!MOVABLE_TYPES.has(obj.type)) return obj;

    let best: { arrow: typeof arrows[number]; d: number } | null = null;
    for (const a of arrows) {
      if (usedArrowIds.has(a.id)) continue;
      const d = dist(obj.x, obj.y, a.geometry.from.x, a.geometry.from.y);
      if (d > ANCHOR_RADIUS) continue;
      if (!best || d < best.d) best = { arrow: a, d };
    }
    if (!best) return obj;

    usedArrowIds.add(best.arrow.id);
    movedIds.push(obj.id);
    return {
      ...obj,
      x: clamp(best.arrow.geometry.to.x),
      y: clamp(best.arrow.geometry.to.y),
    };
  });

  return {
    frame: {
      id: uid(),
      position: 1,
      durationMs,
      notes: frame1.notes,
      objects: newObjects,
      // Keep arrows so the path remains visible on frame 2 too.
      annotations: frame1.annotations ?? [],
    },
    movedCount: movedIds.length,
    movedIds,
  };
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}
