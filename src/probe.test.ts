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

const probe = (label: string, players: any[], teamSize: number, halfSec: number, gkId: string) => {
  const plan = createSubPlan(players as any, teamSize, halfSec, 1, false, false, true, 0, 1, gkId, 6);
  const totals = simulate(players, plan, halfSec);
  console.log(`\n=== ${label} ===`);
  console.log(`Subs: ${plan.length}`);
  [...totals.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,sec])=>{
    const star = (id===players.find(p=>p.currentPitchPosition==="GK")?.id || id===gkId) ? "*GK*" : "    ";
    console.log(`  ${star} ${id.padEnd(12)}: ${(sec/60).toFixed(1)}'`);
  });
  const arr = [...totals.values()];
  console.log(`Spread: ${((Math.max(...arr)-Math.min(...arr))/60).toFixed(1)}'`);
};

describe("probe", () => {
  it("scenarios", () => {
    (globalThis as any).__SUB_DEBUG = false;

    // 8 player 7v7
    const p8 = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80), makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50), makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20), makePlayer("James", "FWD", 70, 20),
      makePlayer("Maximus", null),
    ];
    p8.forEach(p => { if (p.currentPitchPosition && p.currentPitchPosition !== "GK") p.assignedPositions = ["DEF","MID","FWD"]; });
    probe("8 players 7v7 (40min)", p8, 7, 20*60, "Maximus");

    // 10 player 7v7
    const p10 = [
      makePlayer("Archer", "GK"),
      makePlayer("Ezra", "DEF", 30, 80), makePlayer("Augustine", "DEF", 70, 80),
      makePlayer("Jett", "MID", 30, 50), makePlayer("Louie", "MID", 70, 50),
      makePlayer("Hugo", "FWD", 30, 20), makePlayer("James", "FWD", 70, 20),
      makePlayer("Max", null), makePlayer("Tom", null), makePlayer("Sam", null),
    ];
    p10.forEach(p => { if (p.currentPitchPosition && p.currentPitchPosition !== "GK") p.assignedPositions = ["DEF","MID","FWD"]; });
    probe("10 players 7v7 (40min)", p10, 7, 20*60, "Max");

    // 11 player 11v11
    const p13 = Array.from({length: 13}, (_, i) => makePlayer(
      i === 0 ? "GK1" : i === 11 ? "GK2" : `P${i}`,
      i < 11 ? (i===0?"GK":i<5?"DEF":i<8?"MID":"FWD") : null,
      50, 50,
    ));
    p13.forEach(p => { if (p.currentPitchPosition && p.currentPitchPosition !== "GK") p.assignedPositions = ["DEF","MID","FWD"]; });
    probe("13 players 11v11 (60min)", p13, 11, 30*60, "GK2");
  });
});
