import { describe, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
type PitchPosition = "GK" | "DEF" | "MID" | "FWD";

const makePlayer = (name: string, pos: PitchPosition | null = null, x = 50, y = 50, mins = 0): any => ({
  id: name, name,
  currentPitchPosition: pos,
  assignedPositions: pos ? [pos] : [],
  isInjured: false,
  minutesPlayed: mins,
  position: { x, y },
});

describe("debug-planner", () => {
  it("logs", () => {
    const players: any = [
      makePlayer("Archer","GK"),
      makePlayer("Ezra","DEF",30,80),
      makePlayer("Augustine","DEF",70,80),
      makePlayer("Jett","MID",30,50),
      makePlayer("Louie","MID",70,50),
      makePlayer("Hugo","FWD",30,20),
      makePlayer("James","FWD",70,20),
      makePlayer("Maximus",null),
      makePlayer("Tom",null),
      makePlayer("Bench3",null),
      makePlayer("Bench4",null),
    ];
    players.forEach((p:any)=>{ if(p.currentPitchPosition && p.currentPitchPosition!=="GK") p.assignedPositions=["DEF","MID","FWD"]; });
    const halfSec = 20*60;
    for (const speed of [1,2,3]) {
      const plan = createSubPlan(players, 7, halfSec, speed, false, false, true, 0, 1, "Maximus", 5);
      const fieldIds = new Set<string>(players.filter((p:any)=>p.currentPitchPosition).map((p:any)=>p.id));
      const totals = new Map<string,number>();
      players.forEach((p:any)=>totals.set(p.id, (p.minutesPlayed||0)*60));
      const events = [...plan].sort((a:any,b:any)=>{
        const ta=a.half===1?a.time:halfSec+a.time;
        const tb=b.half===1?b.time:halfSec+b.time;
        return ta-tb;
      });
      let last=0;
      for(const e of events as any) {
        const t = e.half===1?e.time:halfSec+e.time;
        fieldIds.forEach(id=>totals.set(id,(totals.get(id)||0)+(t-last)));
        last=t;
        fieldIds.delete(e.playerOut.id);
        fieldIds.add(e.playerIn.id);
      }
      fieldIds.forEach(id=>totals.set(id,(totals.get(id)||0)+(halfSec*2-last)));
      const arr=[...totals.entries()].map(([k,v])=>`${k}:${(v/60).toFixed(1)}`).sort();
      const vals=[...totals.values()].map(s=>s/60);
      console.log(`speed ${speed}: spread=${(Math.max(...vals)-Math.min(...vals)).toFixed(1)}' events=${events.length}`);
      console.log("   ", arr.join(" "));
      console.log("    plan:", events.map((e:any)=>`${e.half==1?'':'2H+'}${Math.floor(e.time/60)}:${(e.time%60).toString().padStart(2,'0')} ${e.playerOut.name}->${e.playerIn.name}`).join("\n          "));
    }
  });
});
