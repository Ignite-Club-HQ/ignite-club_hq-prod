import { describe, it } from "vitest";
import { createSubPlan } from "/dev-server/src/components/pitch/AutoSubPlanDialog";

const makePlayer = (id: string, position: any, x = 50, y = 50) => ({
  id, name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : ["DEF","MID","FWD"],
});

const simulate = (players: any[], plan: any[], halfSec: number) => {
  const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
  const totals = new Map<string, number>(players.map(p => [p.id, 0]));
  const events = [...plan].sort((a,b)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
  let last = 0;
  const totalSec = halfSec*2;
  for (const ev of events) {
    const t = ev.half===1?ev.time:halfSec+ev.time;
    onPitch.forEach(id => totals.set(id, totals.get(id)! + (t-last)));
    last = t;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
  }
  onPitch.forEach(id => totals.set(id, totals.get(id)! + (totalSec-last)));
  return totals;
};

describe("probe", () => {
  it("8 player practical", () => {
    (globalThis as any).__SUB_DEBUG = true;
    const players = [
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
        p.assignedPositions = ["DEF","MID","FWD"];
      }
    });
    const halfSec = 20*60;
    const plan = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 6);
    const totals = simulate(players, plan, halfSec);
    console.log("Plan length:", plan.length);
    console.log("Subs:");
    [...plan].sort((a,b)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time)).forEach(s=>{
      console.log(`  H${s.half} ${Math.floor(s.time/60)}:${String(s.time%60).padStart(2,'0')} OFF=${s.playerOut.id} IN=${s.playerIn.id}`);
    });
    console.log("Totals:");
    [...totals.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,sec])=>{
      console.log(`  ${id}: ${(sec/60).toFixed(1)}'`);
    });
    const arr = [...totals.values()];
    console.log(`Spread: ${((Math.max(...arr)-Math.min(...arr))/60).toFixed(1)}'`);
  });
});
