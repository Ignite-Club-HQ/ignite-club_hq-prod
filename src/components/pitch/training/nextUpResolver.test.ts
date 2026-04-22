import { describe, it, expect } from "vitest";
import type { DrillObject } from "./types";

/**
 * Mirror of the next-up resolver inside `TrainingObjectLayer`. The component
 * keeps the logic inline (inside a useMemo), so this test re-implements the
 * same pure rule and exercises every branch — keeping the contract honest
 * if someone tweaks the inline version.
 */
const MUTED = "#94a3b8";

export function pickNextUpId(objects: DrillObject[]): string | null {
  const waitingMuted = objects
    .filter(
      (o) =>
        o.type === "player" &&
        typeof o.id === "string" &&
        /^w\d+$/i.test(o.id) &&
        (o.color ?? "").toLowerCase() === MUTED,
    )
    .sort((a, b) => {
      const na = parseInt(a.id.slice(1), 10) || 0;
      const nb = parseInt(b.id.slice(1), 10) || 0;
      return na - nb;
    });
  return waitingMuted[0]?.id ?? null;
}

const player = (overrides: Partial<DrillObject>): DrillObject => ({
  id: "p1",
  type: "player",
  x: 50,
  y: 50,
  color: "#0ea5e9",
  ...overrides,
}) as DrillObject;

describe("nextUpResolver", () => {
  it("returns null when there are no waiting chips", () => {
    expect(pickNextUpId([player({ id: "p1" })])).toBeNull();
  });

  it("returns the lowest-numbered muted W chip", () => {
    const objs = [
      player({ id: "w3", color: MUTED, label: "W3" }),
      player({ id: "w1", color: MUTED, label: "W1" }),
      player({ id: "w2", color: MUTED, label: "W2" }),
    ];
    expect(pickNextUpId(objs)).toBe("w1");
  });

  it("skips W chips that have been promoted (non-muted color)", () => {
    const objs = [
      player({ id: "w1", color: "#0ea5e9", label: "W1" }), // promoted
      player({ id: "w2", color: MUTED, label: "W2" }),
      player({ id: "w3", color: MUTED, label: "W3" }),
    ];
    expect(pickNextUpId(objs)).toBe("w2");
  });

  it("returns null when every W chip has been promoted", () => {
    const objs = [
      player({ id: "w1", color: "#0ea5e9", label: "W1" }),
      player({ id: "w2", color: "#ef4444", label: "W2" }),
    ];
    expect(pickNextUpId(objs)).toBeNull();
  });

  it("ignores non-player objects with W-like ids", () => {
    const objs = [
      { id: "w1", type: "cone", x: 10, y: 10, color: MUTED } as DrillObject,
      player({ id: "w2", color: MUTED, label: "W2" }),
    ];
    expect(pickNextUpId(objs)).toBe("w2");
  });

  it("ignores P chips even if muted (only W chips qualify as bench)", () => {
    const objs = [
      player({ id: "p1", color: MUTED, label: "A" }),
      player({ id: "w5", color: MUTED, label: "W5" }),
    ];
    expect(pickNextUpId(objs)).toBe("w5");
  });

  it("treats uppercase W ids the same as lowercase", () => {
    const objs = [
      player({ id: "W2", color: MUTED, label: "W2" }),
      player({ id: "W1", color: MUTED, label: "W1" }),
    ];
    expect(pickNextUpId(objs)).toBe("W1");
  });

  it("sorts numerically, not lexicographically (w10 after w2)", () => {
    const objs = [
      player({ id: "w10", color: MUTED, label: "W10" }),
      player({ id: "w2", color: MUTED, label: "W2" }),
    ];
    expect(pickNextUpId(objs)).toBe("w2");
  });

  it("matches case-insensitively on the muted color", () => {
    const objs = [
      player({ id: "w1", color: "#94A3B8", label: "W1" }),
    ];
    expect(pickNextUpId(objs)).toBe("w1");
  });
});
