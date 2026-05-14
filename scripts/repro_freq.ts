import { createSubPlan } from "../src/components/pitch/AutoSubPlanDialog";

const make = (id: string, pos: any) => ({
  id, name: id,
  position: pos ? { x: 50, y: 50 } : null,
  currentPitchPosition: pos || undefined,
  assignedPositions: pos ? [pos] : ["DEF","MID","FWD"],
});

// 7-a-side: 7 starters + 6 bench = 13. 10-min halves. Frequent mode.
const players = [
  make("Ellis","GK"),
  make("Emery","DEF"),
  make("Finley","DEF"),
  make("Flynn","MID"),
  make("Harper","MID"),
  make("Jamie","FWD"),
  make("JordanC","FWD"),
  make("Haven", null),
  make("Hayden", null),
  make("Indigo", null),
  make("JordanH", null),
  make("JordanT", null),
  make("JordanHo", null),
];

const halfSec = 10*60;
const plan = createSubPlan(players as any, 7, halfSec, 2, false, false, true, 0, 1, "Emery", 5);

const onPitch = new Set<string>(players.filter(p=>p.position).map(p=>p.id));
const totals = new Map<string,number>(players.map(p=>[p.id,0]));
const events = [...plan].sort((a,b)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
let last=0;
for (const ev of events) {
  const t = ev.half===1?ev.time:halfSec+ev.time;
  onPitch.forEach(id=>totals.set(id,totals.get(id)!+(t-last)));
  last=t;
  onPitch.delete(ev.playerOut.id);
  onPitch.add(ev.playerIn.id);
}
onPitch.forEach(id=>totals.set(id,totals.get(id)!+(halfSec*2-last)));
console.log("subs:", plan.length);
[...totals.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,s])=>console.log(id, (s/60).toFixed(1)+"'"));
