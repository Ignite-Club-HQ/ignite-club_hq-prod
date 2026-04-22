import { describe, it, expect } from "vitest";
import { interpolateFrames, staticFrame } from "../interpolation";
import type { Annotation, DrillFrame, DrillObject } from "../types";

/**
 * Snapshot tests for drill playback geometry.
 *
 * These lock arrow endpoints, player positions, and fade behaviour at the
 * three visually critical timestamps (start, midpoint, end). If renderer
 * code changes the easing curve, the matching strategy, or the cross-fade
 * model, the snapshots will fail and force a deliberate review.
 */

const player = (id: string, x: number, y: number, label: string): DrillObject => ({
  id,
  type: "player",
  x,
  y,
  rotation: 0,
  label,
  color: "#0ea5e9",
  size: 1,
});

const arrow = (
  id: string,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  dashed = false
): Annotation => ({
  id,
  type: dashed ? "arrow-dashed" : "arrow-solid",
  geometry: { from: { x: fx, y: fy }, to: { x: tx, y: ty } },
  style: { color: dashed ? "#a78bfa" : "#fbbf24", width: 2 },
});

// Frame A: P1 at (50,80), P2 at (35,60); arrow from P1 → P2
const FRAME_A: DrillFrame = {
  id: "fA",
  position: 0,
  durationMs: 1500,
  notes: "start",
  objects: [player("p1", 50, 80, "1"), player("p2", 35, 60, "2")],
  annotations: [arrow("a1", 50, 80, 35, 60)],
};

// Frame B: P1 has moved to (35,60), P2 to (50,30); new arrow P2 → goal area
const FRAME_B: DrillFrame = {
  id: "fB",
  position: 1,
  durationMs: 1500,
  notes: "end",
  objects: [
    player("p1", 35, 60, "1"),
    player("p2", 50, 30, "2"),
    // new entrant only in B
    player("p3", 70, 40, "3"),
  ],
  annotations: [arrow("a2", 50, 30, 50, 10, true)],
};

describe("interpolateFrames (snapshots)", () => {
  it("t=0 returns frame A geometry (objects opaque, A annotations opaque, B at 0)", () => {
    expect(interpolateFrames(FRAME_A, FRAME_B, 0)).toMatchSnapshot();
  });

  it("t=0.5 tweens shared objects, fades incoming p3, cross-fades arrows", () => {
    const mid = interpolateFrames(FRAME_A, FRAME_B, 0.5);
    // Sanity: shared player p1 should be midway between (50,80) and (35,60).
    // With ease-in-out cubic at t=0.5 the eased value is exactly 0.5.
    const p1 = mid.objects.find((o) => o.id === "p1")!;
    expect(p1.x).toBeCloseTo(42.5, 5);
    expect(p1.y).toBeCloseTo(70, 5);
    // p3 only exists in B → opacity equals eased t (0.5)
    const p3 = mid.objects.find((o) => o.id === "p3")!;
    expect(p3.opacity).toBeCloseTo(0.5, 5);
    expect(mid).toMatchSnapshot();
  });

  it("t=1 returns frame B geometry (objects opaque, A annotations at 0, B at 1)", () => {
    expect(interpolateFrames(FRAME_A, FRAME_B, 1)).toMatchSnapshot();
  });

  it("clamps t outside [0,1] without throwing", () => {
    const under = interpolateFrames(FRAME_A, FRAME_B, -0.5);
    const over = interpolateFrames(FRAME_A, FRAME_B, 1.5);
    expect(under).toEqual(interpolateFrames(FRAME_A, FRAME_B, 0));
    expect(over).toEqual(interpolateFrames(FRAME_A, FRAME_B, 1));
  });

  it("staticFrame preserves all geometry at full opacity", () => {
    expect(staticFrame(FRAME_A)).toMatchSnapshot();
  });

  it("arrow endpoints are never mutated by interpolation (input is pure)", () => {
    const beforeFrom = { ...(FRAME_A.annotations[0].geometry as any).from };
    const beforeTo = { ...(FRAME_A.annotations[0].geometry as any).to };
    interpolateFrames(FRAME_A, FRAME_B, 0.5);
    const afterFrom = (FRAME_A.annotations[0].geometry as any).from;
    const afterTo = (FRAME_A.annotations[0].geometry as any).to;
    expect(afterFrom).toEqual(beforeFrom);
    expect(afterTo).toEqual(beforeTo);
  });
});
