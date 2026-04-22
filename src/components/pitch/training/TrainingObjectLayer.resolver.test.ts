import { describe, it, expect } from "vitest";
import {
  chipPixelSize,
  resolvePlayerOverlaps,
} from "./TrainingObjectLayer";
import type { DrillObject } from "./types";

/**
 * Unit tests for the player-chip overlap resolver.
 *
 * The resolver guarantees that no two player chips end up closer than the
 * sum of their per-axis half-extents (derived from the actual rendered chip
 * size + the small visual breathing-room pad the resolver applies).
 *
 * We re-implement the *expected minimum distance* here using the same
 * `chipPixelSize` helper the resolver uses internally — this way the test
 * tracks the real chip sizing logic instead of hard-coding magic numbers.
 */

const CONTAINER = { w: 400, h: 600 };

// Match the resolver's internal padding: 4px in each axis, expressed in %.
const PAD_X_PCT = (4 / CONTAINER.w) * 100;
const PAD_Y_PCT = (4 / CONTAINER.h) * 100;

function player(
  id: string,
  x: number,
  y: number,
  label?: string,
): DrillObject {
  return { id, type: "player", x, y, color: "#0ea5e9", label };
}

/**
 * Required centre-to-centre distance for two chips on the elliptical
 * collision model the resolver uses. Two chips are considered "not
 * overlapping" iff sqrt((dx/reqX)^2 + (dy/reqY)^2) >= 1, i.e. they sit
 * outside the bounding ellipse defined by (reqX, reqY).
 */
function ellipticalSeparation(a: DrillObject, b: DrillObject) {
  const sa = chipPixelSize(a);
  const sb = chipPixelSize(b);
  const reqX =
    (sa.w / 2 / CONTAINER.w) * 100 +
    (sb.w / 2 / CONTAINER.w) * 100 +
    PAD_X_PCT;
  const reqY =
    (sa.h / 2 / CONTAINER.h) * 100 +
    (sb.h / 2 / CONTAINER.h) * 100 +
    PAD_Y_PCT;
  return { reqX, reqY };
}

function assertNoOverlap(objects: DrillObject[]) {
  const positions = resolvePlayerOverlaps(objects, CONTAINER);
  // Tiny numerical slack — the relaxation loop converges to ndist ≈ 1.0
  // but isn't always exactly there due to the 0.55 step size.
  const SLACK = 0.02;

  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i];
      const b = objects[j];
      const pa = positions.get(a.id);
      const pb = positions.get(b.id);
      expect(pa, `position missing for ${a.id}`).toBeDefined();
      expect(pb, `position missing for ${b.id}`).toBeDefined();
      const { reqX, reqY } = ellipticalSeparation(a, b);
      const dx = pb!.x - pa!.x;
      const dy = pb!.y - pa!.y;
      const ndist = Math.hypot(dx / reqX, dy / reqY);
      expect(
        ndist,
        `chips ${a.id} and ${b.id} overlap: ndist=${ndist.toFixed(3)} ` +
          `(needs >= ${(1 - SLACK).toFixed(3)})`,
      ).toBeGreaterThanOrEqual(1 - SLACK);
    }
  }
}

describe("resolvePlayerOverlaps", () => {
  it("returns single-player position unchanged", () => {
    const objs = [player("p1", 50, 50, "Alex")];
    const out = resolvePlayerOverlaps(objs, CONTAINER);
    expect(out.get("p1")).toEqual({ x: 50, y: 50 });
  });

  it("preserves already-spaced chips (no spurious nudging)", () => {
    const objs = [
      player("p1", 20, 20, "A"),
      player("p2", 80, 80, "B"),
    ];
    const out = resolvePlayerOverlaps(objs, CONTAINER);
    expect(out.get("p1")).toEqual({ x: 20, y: 20 });
    expect(out.get("p2")).toEqual({ x: 80, y: 80 });
  });

  it("separates two chips placed at the exact same coordinates", () => {
    const objs = [
      player("p1", 50, 50, "Alex"),
      player("p2", 50, 50, "Sam"),
    ];
    assertNoOverlap(objs);
  });

  it("separates a tight horizontal row of medium-label pill chips", () => {
    // Four medium-name chips packed 8% apart. With ~5–6% half-widths each,
    // pairs need ~12% of separation — well inside the 100% pitch width so
    // the resolver should always fully separate them along the row.
    const objs = [
      player("p1", 30, 50, "Alex"),
      player("p2", 38, 50, "Sam"),
      player("p3", 46, 50, "Jordan"),
      player("p4", 54, 50, "Leo"),
    ];
    assertNoOverlap(objs);
  });

  it("separates a tight horizontal row of waiting (small) chips", () => {
    const objs = [
      player("w1", 50, 90, "Alex"),
      player("w2", 56, 90, "Sam"),
      player("w3", 62, 90, "Jo"),
      player("w4", 68, 90, "Leo"),
    ];
    assertNoOverlap(objs);
  });

  it("separates a 3x3 grid of chips packed too tightly", () => {
    const objs: DrillObject[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        objs.push(player(`p${r}${c}`, 40 + c * 6, 40 + r * 6, "Sam"));
      }
    }
    assertNoOverlap(objs);
  });

  it("handles a mix of active + waiting chips on the same row", () => {
    const objs = [
      player("p1", 30, 80, "Alex"),
      player("w1", 36, 80, "Sam"),
      player("p2", 42, 80, "Jordan"),
      player("w2", 48, 80, "Leo"),
    ];
    assertNoOverlap(objs);
  });

  it("keeps resolved positions inside the 0–100 pitch bounds", () => {
    // Pin chips to the corners so any nudge could push them off-pitch
    // unless the clamp is honoured.
    const objs = [
      player("p1", 0, 0, "Alex"),
      player("p2", 0, 0, "Sam"),
      player("p3", 100, 100, "Jordan"),
      player("p4", 100, 100, "Leo"),
    ];
    const out = resolvePlayerOverlaps(objs, CONTAINER);
    for (const o of objs) {
      const pos = out.get(o.id)!;
      expect(pos.x, `${o.id}.x out of bounds`).toBeGreaterThanOrEqual(0);
      expect(pos.x, `${o.id}.x out of bounds`).toBeLessThanOrEqual(100);
      expect(pos.y, `${o.id}.y out of bounds`).toBeGreaterThanOrEqual(0);
      expect(pos.y, `${o.id}.y out of bounds`).toBeLessThanOrEqual(100);
    }
  });

  it("falls back to default container when none is provided", () => {
    // Resolver should still produce non-overlapping positions even when
    // the container size hasn't been measured yet (first paint).
    const objs = [
      player("p1", 50, 50, "Alex"),
      player("p2", 50, 50, "Sam"),
    ];
    const out = resolvePlayerOverlaps(objs, null);
    const a = out.get("p1")!;
    const b = out.get("p2")!;
    // Centres must have moved apart on at least one axis.
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0);
  });

  it("ignores non-player objects when resolving (cones/balls untouched)", () => {
    const objs: DrillObject[] = [
      player("p1", 50, 50, "Alex"),
      { id: "b1", type: "ball", x: 50, y: 50, color: "#fff" },
      { id: "c1", type: "cone", x: 50, y: 50, color: "#f59e0b" },
    ];
    const out = resolvePlayerOverlaps(objs, CONTAINER);
    // Only the player should have an entry — cones / balls are untouched
    // by the player-overlap resolver (the ball resolver handles those).
    expect(out.has("p1")).toBe(true);
    expect(out.has("b1")).toBe(false);
    expect(out.has("c1")).toBe(false);
  });
});
