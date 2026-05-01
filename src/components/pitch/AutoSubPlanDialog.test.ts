import { describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
import type { PitchPosition } from "./PositionBadge";

const makePlayer = (
  id: string,
  position: PitchPosition | null,
  x = 50,
  y = 50,
) => ({
  id,
  name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"] as PitchPosition[],
});

describe("createSubPlan", () => {
  it("does not take a newly introduced bench player off at the next rotation when alternatives exist", () => {
    const players = [
      makePlayer("A", "DEF"),
      makePlayer("B", "DEF"),
      makePlayer("C", "MID"),
      makePlayer("D", "MID"),
      makePlayer("E", "MID"),
      makePlayer("F", "FWD"),
      makePlayer("G", "FWD"),
      makePlayer("Max", null),
      makePlayer("H", null),
      makePlayer("I", null),
    ];

    const plan = createSubPlan(players, 7, 1200, 2, true, false, false);
    const ordered = [...plan].sort((a, b) =>
      (a.half === 1 ? a.time : 1200 + a.time) - (b.half === 1 ? b.time : 1200 + b.time)
    );

    const windows = ordered.reduce<Array<{ time: number; ins: Set<string>; outs: Set<string> }>>((acc, sub) => {
      const time = sub.half === 1 ? sub.time : 1200 + sub.time;
      const last = acc[acc.length - 1];
      const window = last?.time === time ? last : { time, ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(sub.playerIn.id);
      window.outs.add(sub.playerOut.id);
      if (window !== last) acc.push(window);
      return acc;
    }, []);

    expect(windows.length).toBeGreaterThan(2);
    for (let i = 1; i < windows.length; i++) {
      windows[i - 1].ins.forEach(playerId => {
        expect(windows[i].outs.has(playerId)).toBe(false);
      });
    }
  });
});