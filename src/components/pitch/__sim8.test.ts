import { describe, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";

const makePlayer = (id: string, position: any, x = 50, y = 50) => ({
  id, name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF", "MID", "FWD"],
});

describe("sim8b", () => {
  it("dumps full plan", () => {
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
    const plan = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    const sorted = [...plan].sort((a: any, b: any) =>
      (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time));
    sorted.forEach(s => {
      const abs = (s.half === 1 ? s.time : halfSec + s.time) / 60;
      console.log(`  ${abs.toFixed(1).padStart(5)}'  H${s.half} ${s.time/60}'  OUT:${s.playerOut.id.padEnd(10)} IN:${s.playerIn.id}`);
    });
  });
});
