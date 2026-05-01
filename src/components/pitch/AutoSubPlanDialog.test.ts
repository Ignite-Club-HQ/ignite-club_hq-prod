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
    expect(practical.length, `practical subs ${practical.length}`).toBeLessThanOrEqual(25);

    // Practical fairness floor (OUTFIELD-ONLY): no outfield-eligible player
    // below 75% of target. GKs are EXCLUDED from this check because they
    // can ONLY swap at halftime — they don't take outfield shifts mid-half.
    const practicalTotals = simulateTotals(players, practical, halfSec);
    const fieldPositions = players.filter(p => p.position && p.currentPitchPosition !== "GK").length;
    const outfield = players.filter(
      p => !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK"),
    );
    const targetSec = (halfSec * 2 * fieldPositions) / outfield.length;
    const minSec = targetSec * 0.75;
    const gkIds = new Set(["Archer", "Maximus"]);
    const outfieldNonGkIds = new Set(outfield.map(p => p.id).filter(id => !gkIds.has(id)));
    const lows = [...practicalTotals.entries()]
      .filter(([id]) => outfieldNonGkIds.has(id))
      .filter(([, sec]) => sec < minSec);
    expect(lows, `players below 75% floor: ${lows.map(([id, s]) => `${id}=${(s/60).toFixed(1)}'`).join(", ")}`).toEqual([]);

    // GKs play exactly their half (20'). Outfielders should be tightly spread.
    const outfieldOnlyTotals = [...practicalTotals.entries()].filter(([id]) => outfieldNonGkIds.has(id));
    const outfieldVals = outfieldOnlyTotals.map(([, s]) => s);
    const outfieldSpread = (Math.max(...outfieldVals) - Math.min(...outfieldVals)) / 60;
    expect(outfieldSpread, `outfield-only spread = ${outfieldSpread.toFixed(1)}'`).toBeLessThanOrEqual(10);

    // Regression for the 9-player mobile case.
    const ninePlayerPractical = createSubPlan(players.slice(0, 9) as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    const nineTotals = simulateTotals(players.slice(0, 9), ninePlayerPractical, halfSec);
    const nineOutfield = [...nineTotals.entries()].filter(([id]) => !gkIds.has(id)).map(([, s]) => s);
    const nineSpread = (Math.max(...nineOutfield) - Math.min(...nineOutfield)) / 60;
    expect(nineSpread, `9-player Practical outfield spread = ${nineSpread.toFixed(1)}'`).toBeLessThanOrEqual(10);
    // GKs play their full half = 20'.
    expect(nineTotals.get("Archer")! / 60, "1H GK plays 1H").toBeGreaterThanOrEqual(20);
    expect(nineTotals.get("Maximus")! / 60, "2H GK plays 2H").toBeGreaterThanOrEqual(20);

    const practicalWindows = practical.reduce<Array<{ time: number; ins: Set<string>; outs: Set<string> }>>((acc, sub) => {
      const time = sub.half === 1 ? sub.time : halfSec + sub.time;
      const last = acc[acc.length - 1];
      const window = last?.time === time ? last : { time, ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(sub.playerIn.id);
      window.outs.add(sub.playerOut.id);
      if (window !== last) acc.push(window);
      return acc;
    }, []);
    practicalWindows.forEach(window => {
      window.ins.forEach(playerId => {
        expect(window.outs.has(playerId), `${playerId} was subbed on and off in the same Practical window`).toBe(false);
      });
    });

    // Frequent honours tight spread.
    const plan = createSubPlan(players as any, 7, halfSec, 2, false, false, true, 0, 1, "Maximus", 5);
    const totals = simulateTotals(players, plan, halfSec);
    const arr = [...totals.values()];
    const spread = (Math.max(...arr) - Math.min(...arr)) / 60;
    // Light Frequent: longer shifts (~3 min floor) widen the spread vs the
    // old 2-min cadence, but stay tighter than Practical (which allows ~10').
    expect(spread, `frequent spread = ${spread.toFixed(1)}'`).toBeLessThanOrEqual(9.5);
  });
});
