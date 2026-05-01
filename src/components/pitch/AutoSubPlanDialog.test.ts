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

const simulateTotals = (
  players: ReturnType<typeof makePlayer>[],
  plan: ReturnType<typeof createSubPlan>,
  halfSec: number,
) => {
  const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
  const totals = new Map<string, number>(players.map(p => [p.id, 0]));
  const events = [...plan].sort((a, b) =>
    (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time)
  );
  let last = 0;
  const totalSec = halfSec * 2;
  for (const ev of events) {
    const t = ev.half === 1 ? ev.time : halfSec + ev.time;
    onPitch.forEach(id => totals.set(id, totals.get(id)! + (t - last)));
    last = t;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
  }
  onPitch.forEach(id => totals.set(id, totals.get(id)! + (totalSec - last)));
  return totals;
};

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

    const plan = createSubPlan(players as any, 7, 1200, 2, true, false, false);
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

  it("U8 minimal-rotation: spread between most & least played stays under 5 min", () => {
    // U8: 11 players, 7 a side, 40-min game (two 20-min halves), GK rotates at HT.
    const players = [
      makePlayer("Archer", "GK"),         // GK 1H
      makePlayer("Ezra", "DEF", 30, 80),
      makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50),
      makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20),
      makePlayer("James", "FWD", 70, 20),
      makePlayer("Maximus", null), // becomes 2H GK
      makePlayer("Tom", null),
      makePlayer("Bench3", null),
      makePlayer("Bench4", null),
    ];
    // Make outfielders flexible so position constraints don't dominate.
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });

    const halfSec = 20 * 60;
    // With maxSpreadMinutes=5 the planner should cap projected spread to ≤ ~5'
    // even in Minimal mode; allow a small tolerance for end-of-half snap effects.
    for (const speed of [1, 2, 3]) {
      const plan = createSubPlan(players as any, 7, halfSec, speed, false, false, true, 0, 1, "Maximus", 5);
      const totals = simulateTotals(players, plan, halfSec);
      const arr = [...totals.values()];
      const spread = (Math.max(...arr) - Math.min(...arr)) / 60;
      expect(spread, `speed ${speed} spread = ${spread.toFixed(1)}'`).toBeLessThanOrEqual(7);
    }
  });
});
