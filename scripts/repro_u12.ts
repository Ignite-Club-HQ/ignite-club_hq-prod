import { createSubPlan } from "../src/components/pitch/AutoSubPlanDialog";

const make = (id: string, pos: any, x=50, y=50) => ({
  id, name: id,
  position: pos ? { x, y } : null,
  currentPitchPosition: pos || undefined,
  assignedPositions: pos ? [pos] : ["DEF","MID","FWD"],
});

// 9v9 + 4 bench = 13 players
const players = [
  make("Ellis","GK"),
  make("Emery","DEF"),
  make("P3","DEF"),
  make("P4","DEF"),
  make("P5","MID"),
  make("P6","MID"),
  make("P7","MID"),
  make("P8","FWD"),
  make("P9","FWD"),
  make("B1",null),
  make("B2",null),
  make("B3",null),
  make("B4",null),
];
players[1].assignedPositions = ["GK","DEF","MID","FWD"]; // Emery can GK 2H

const halfSec = 10*60; // total match 20 min, target 13.8 = 9*20/13
const plan = createSubPlan(players as any, 9, halfSec, 2, false, false, true, 0, 1, "Emery", 5);
console.log("subs:", plan.length);
plan.forEach(s => console.log(`  H${s.half} ${s.time}s: OUT ${s.playerOut.id} → IN ${s.playerIn.id}`));

// simulate
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
