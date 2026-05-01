import { describe, it } from "vitest";
import { createSubPlan } from "/dev-server/src/components/pitch/AutoSubPlanDialog";
const mk = (id: string, pos: any, x=50, y=50) => ({ id, name: id, position: pos?{x,y}:null, currentPitchPosition: pos||undefined, assignedPositions: pos?[pos]:["DEF","MID","FWD"] });
const sim = (players: any[], plan: any[], halfSec: number) => {
  const onPitch = new Set<string>(players.filter(p => p.position).map(p => p.id));
  const totals = new Map<string, number>(players.map(p => [p.id, 0]));
  const events = [...plan].sort((a,b)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
  let last = 0; const totalSec = halfSec*2;
  for (const ev of events) { const t = ev.half===1?ev.time:halfSec+ev.time; onPitch.forEach(id => totals.set(id, totals.get(id)! + (t-last))); last = t; onPitch.delete(ev.playerOut.id); onPitch.add(ev.playerIn.id); }
  onPitch.forEach(id => totals.set(id, totals.get(id)! + (totalSec-last)));
  return totals;
};
describe("p", () => { it("8p", () => {
  const p = [mk("Archer","GK"),mk("Ezra","DEF",30,80),mk("Augustine","DEF",70,80),mk("Jett","MID",30,50),mk("Louie","MID",70,50),mk("Hugo","FWD",30,20),mk("James","FWD",70,20),mk("Maximus",null)];
  p.forEach(pp=>{if(pp.currentPitchPosition&&pp.currentPitchPosition!=="GK")pp.assignedPositions=["DEF","MID","FWD"]});
  const plan = createSubPlan(p as any, 7, 20*60, 1, false, false, true, 0, 1, "Maximus", 6);
  const t = sim(p, plan, 20*60);
  console.log("Subs:", plan.length);
  [...t.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,s])=>{const gk=(id==="Archer"||id==="Maximus")?"GK":"  ";console.log(`${gk} ${id.padEnd(11)}: ${(s/60).toFixed(1)}'`);});
  const arr=[...t.values()]; console.log(`Spread: ${((Math.max(...arr)-Math.min(...arr))/60).toFixed(1)}'`);
});});
