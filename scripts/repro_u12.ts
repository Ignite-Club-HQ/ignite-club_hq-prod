import { createSubPlan } from "../src/components/pitch/AutoSubPlanDialog";

const make = (id: string, pos: any, x=50, y=50) => ({
  id, name: id,
  position: pos ? { x, y } : null,
  currentPitchPosition: pos || undefined,
  assignedPositions: pos ? [pos] : ["DEF","MID","FWD"],
});

// 7v7 + 6 bench = 13 players (Riverside U12 boys)
const players = [
  make("GK1","GK"),
  make("D1","DEF"),
  make("D2","DEF"),
  make("M1","MID"),
  make("M2","MID"),
  make("F1","FWD"),
  make("F2","FWD"),
  make("B1",null),
  make("B2",null),
  make("B3",null),
  make("B4",null),
  make("B5",null),
  make("B6",null),
];
players[1].assignedPositions = ["GK","DEF","MID","FWD"];

const halfSec = 10 * 60; // 20 min match
// User's slider settings from screenshot 2
const plan = createSubPlan(players as any, 7, halfSec, 2, false, false, true, 0, 1, "B1", 5, {
  standardTargetIntervalSec: 690, // 11.5 min
  standardIntervalFloorSec: 600,  // 10 min
  frequentIntervalFloorSec: 390,  // 6.5 min
  minShiftSeconds: 288,           // 4.8 min
  halftimeGuardSeconds: 408,      // 6.8 min
});

console.log("subs:", plan.length);
plan.forEach(s => console.log(`  H${s.half} ${(s.time/60).toFixed(1)}m: OUT ${s.playerOut.id} → IN ${s.playerIn.id}`));

const onPitch = new Set(players.filter(p=>p.position).map(p=>p.id));
const totals = new Map(players.map(p=>[p.id,0]));
const events = [...plan].sort((a,b)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
let last=0;
for (const ev of events) {
  const t = ev.half===1?ev.time:halfSec+ev.time;
  onPitch.forEach(id => totals.set(id, totals.get(id)! + (t-last)));
  last = t;
  onPitch.delete(ev.playerOut.id);
  onPitch.add(ev.playerIn.id);
}
onPitch.forEach(id => totals.set(id, totals.get(id)! + (halfSec*2 - last)));
console.log("\nMinutes per player:");
[...totals.entries()].sort((a,b)=>a[1]-b[1]).forEach(([id,s])=>console.log(`  ${id}: ${(s/60).toFixed(1)}'`));
