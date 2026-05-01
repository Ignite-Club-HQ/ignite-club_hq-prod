import { describe, it } from "vitest";
import { createSubPlan } from "./components/pitch/AutoSubPlanDialog";

const makePlayer = (id: string, position: any, x = 50, y = 50) => ({
  id, name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"] as any,
});

describe("audit", () => {
  it("audit", () => {
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
        p.assignedPositions = ["DEF", "MID", "FWD"] as any;
      }
    });
    const halfSec = 20 * 60;
    const simulate = (plan: any[]) => {
      const onPitch = new Set(players.filter(p => p.position).map(p => p.id));
      const totals = new Map<string, number>(players.map(p => [p.id, 0]));
      const events = [...plan].sort((a,b) => (a.half===1?a.time:halfSec+a.time) - (b.half===1?b.time:halfSec+b.time));
      let last = 0;
      for (const ev of events) {
        const t = ev.half === 1 ? ev.time : halfSec + ev.time;
        onPitch.forEach((id) => totals.set(id, (totals.get(id) || 0) + (t - last)));
        last = t;
        onPitch.delete(ev.playerOut.id);
        onPitch.add(ev.playerIn.id);
      }
      onPitch.forEach((id) => totals.set(id, (totals.get(id) || 0) + (halfSec*2 - last)));
      return totals;
    };
    for (const speed of [1, 2, 3]) {
      for (const cap of [3, 5, 7, 10]) {
        const plan = createSubPlan(players as any, 7, halfSec, speed, false, false, true, 0, 1, "Maximus", cap);
        const totals = simulate(plan);
        const arr = [...totals.values()].map(s => s/60);
        const spread = (Math.max(...arr) - Math.min(...arr));
        // eslint-disable-next-line no-console
        console.log(`speed=${speed} cap=${cap}: subs=${plan.length} spread=${spread.toFixed(1)}' min=${Math.min(...arr).toFixed(1)} max=${Math.max(...arr).toFixed(1)}`);
      }
    }
  });
});
