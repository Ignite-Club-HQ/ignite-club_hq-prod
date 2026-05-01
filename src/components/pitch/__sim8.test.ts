import { describe, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
const mp = (id: string, position: any, x = 50, y = 50) => ({ id, name: id, position: position ? { x, y } : null, currentPitchPosition: position || undefined, assignedPositions: position ? [position] : ["DEF","MID","FWD"] });
describe("s", () => { it("s", () => {
  const players: any[] = [mp("Archer","GK"),mp("Ezra","DEF",30,80),mp("Augustine","DEF",70,80),mp("Jett","MID",30,50),mp("Louie","MID",70,50),mp("Hugo","FWD",30,20),mp("James","FWD",70,20),mp("Maximus",null)];
  players.forEach(p => { if (p.currentPitchPosition && p.currentPitchPosition !== "GK") p.assignedPositions = ["DEF","MID","FWD"]; });
  const halfSec = 20*60;
  const plan = createSubPlan(players as any, 7, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
  const sorted = [...plan].sort((a:any,b:any) => (a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
  console.log("PLAN ("+plan.length+" subs):");
  sorted.forEach((s:any) => { const abs=(s.half===1?s.time:halfSec+s.time)/60; console.log(`  ${abs.toFixed(1)}'  OUT:${s.playerOut.id} IN:${s.playerIn.id}`); });
  const onP = new Set<string>(players.filter(p=>p.position).map(p=>p.id));
  const tot = new Map<string,number>(players.map(p=>[p.id,0]));
  const benched = new Set<string>();
  let last=0; const totalSec=halfSec*2;
  for (const ev of sorted) { const t=ev.half===1?ev.time:halfSec+ev.time; onP.forEach(id=>tot.set(id,tot.get(id)!+(t-last))); last=t; benched.add(ev.playerOut.id); onP.delete(ev.playerOut.id); onP.add(ev.playerIn.id); }
  onP.forEach(id=>tot.set(id,tot.get(id)!+(totalSec-last)));
  console.log("\nTOTALS:");
  [...tot.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,s])=>console.log(`  ${id.padEnd(10)} ${(s/60).toFixed(1)}'  ${benched.has(id)?"✓ benched":"✗ NEVER BENCHED"}`));
  const vals=[...tot.values()];
  console.log(`Spread: ${((Math.max(...vals)-Math.min(...vals))/60).toFixed(1)}'`);
  const starters = players.filter(p=>p.position && p.id!=="Archer").map(p=>p.id);
  const missed = starters.filter(id=>!benched.has(id));
  console.log(`Never-benched starters: ${missed.length===0?"NONE ✓":missed.join(", ")}`);
}); });
