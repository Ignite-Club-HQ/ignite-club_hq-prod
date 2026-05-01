import { describe, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";

const makePlayer = (id: string, position: any, x = 50, y = 50) => ({
  id, name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"],
});

describe("sim8", () => {
  it("logs spread for 8 players", () => {
    const players: any[] = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80),
      makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50),
      makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20),
      makePlayer("James", "FWD", 70, 20),
      makePlayer("Maximus", null),
    ];
    players.forEach(p => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF", "MID", "FWD"];
      }
    });
    const halfSec = 20 * 60;
    const simulate = (plan: any) => {
      const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
      const totals = new Map<string, number>(players.map(p => [p.id, 0]));
      const events = [...plan].sort((a: any, b: any) =>
        (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time));
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
    for (const [label, mode] of [["Practical", 1], ["Frequent", 2]] as const) {
      const plan = createSubPlan(players as any, 7, halfSec, mode, false, false, true, 0, 1, "Maximus", 5);
      const totals = simulate(plan);
      const arr = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      const vals = arr.map(([, s]) => s);
      const spread = (Math.max(...vals) - Math.min(...vals)) / 60;
      console.log(`\n=== ${label} (${plan.length} subs) ===`);
      arr.forEach(([id, s]) => console.log(`  ${id.padEnd(12)} ${(s/60).toFixed(1)}'`));
      console.log(`  Spread: ${spread.toFixed(1)}'`);
    }
  });
});
