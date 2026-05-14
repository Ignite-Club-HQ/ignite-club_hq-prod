import { createSubPlan } from "../src/components/pitch/AutoSubPlanDialog";

const make = (id: string, num: number, pos: any) => ({
  id, name: id, number: num,
  position: pos ? { x: 50, y: 50 } : null,
  currentPitchPosition: pos || undefined,
  assignedPositions: pos ? [pos] : ["DEF","MID","FWD"],
});

// Try 9-a-side: 9 starters + 4 bench = 13. 10-min halves.
const players = [
  make("Ellis",1,"GK"),
  make("Emery",2,"DEF"),
  make("Finley",3,"DEF"),
  make("Flynn",4,"MID"),
  make("Harper",5,"MID"),
  make("Haven",6,"DEF"),
  make("Hayden",7,"DEF"),
  make("Indigo",8,"MID"),
  make("Jamie",9,"MID"),
  make("JordanC",10,"FWD"),
  make("JordanH",11,null),
  make("JordanHo",12,null),
  make("JordanT",13,null),
];

for (const mode of [1, 2] as const) {
  const halfSec = 10*60;
  const plan = createSubPlan(players as any, 9, halfSec, mode, false, false, true, 0, 1, "Emery", 5);
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
  console.log(`\n=== Mode ${mode} === subs:`, plan.length);
  [...totals.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,s])=>console.log(id, (s/60).toFixed(1)+"'"));
}
