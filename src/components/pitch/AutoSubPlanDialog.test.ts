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

  it("U8 2-mode rotation: Frequent honours spread; Practical keeps subs low", () => {
    // Practical (1) prioritises low disruption — wider spread is acceptable.
    // Frequent (2) honours the spread cap tightly.
    const players = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80),
      makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50),
      makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20),
      makePlayer("James", "FWD", 70, 20),
      makePlayer("Maximus", null),
      makePlayer("Tom", null),
      makePlayer("Bench3", null),
      makePlayer("Bench4", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
      }
    });

    const halfSec = 20 * 60;
    // Practical: low sub count, soft fairness — accepts wider spread.
    const practical = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    expect(practical.length, `practical subs ${practical.length}`).toBeLessThanOrEqual(15);

    // Practical fairness floor: no outfield player below 75% of target.
    const practicalTotals = simulateTotals(players, practical, halfSec);
    const fieldPositions = players.filter(p => p.position && p.currentPitchPosition !== "GK").length;
    const outfield = players.filter(
      p => !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK"),
    );
    const targetSec = (halfSec * 2 * fieldPositions) / outfield.length;
    const minSec = targetSec * 0.75;
    // Exclude pure GKs from the check (they don't rotate outfield here).
    const outfieldIds = new Set(outfield.map(p => p.id));
    const lows = [...practicalTotals.entries()]
      .filter(([id]) => outfieldIds.has(id))
      .filter(([, sec]) => sec < minSec);
    expect(lows, `players below 75% floor: ${lows.map(([id, s]) => `${id}=${(s/60).toFixed(1)}'`).join(", ")}`).toEqual([]);

    // Frequent honours tight spread.
    const plan = createSubPlan(players as any, 7, halfSec, 2, false, false, true, 0, 1, "Maximus", 5);
    const totals = simulateTotals(players, plan, halfSec);
    const arr = [...totals.values()];
    const spread = (Math.max(...arr) - Math.min(...arr)) / 60;
    expect(spread, `frequent spread = ${spread.toFixed(1)}'`).toBeLessThanOrEqual(8.5);
  });
});

