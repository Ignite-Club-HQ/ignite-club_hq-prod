import { describe, it } from "vitest";
import { createSubPlan } from "/dev-server/src/components/pitch/AutoSubPlanDialog";

const mk = (id: string, pos: any, x=50, y=50) => ({
  id, name: id,
  position: pos ? { x, y } : null,
  currentPitchPosition: pos || undefined,
  assignedPositions: pos ? [pos] : ["DEF","MID","FWD"],
});

describe("user scenario", () => {
  it("9 outfield + GK + 2 bench (total 11)", () => {
    const players = [
      mk("Archer", "GK"),
      mk("Ezra", "DEF", 30, 80),
      mk("Augustine", "DEF", 70, 80),
      mk("Jett", "MID", 30, 50),
      mk("Louie", "MID", 70, 50),
      mk("Hugo", "FWD", 30, 20),
      mk("James", "FWD", 70, 20),
      mk("Player8", "MID", 50, 50),
      mk("Player9", "FWD", 50, 25),
      mk("Maximus", null),
      mk("Tom", null),
    ];
    players.forEach((p:any) => {
      if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
        p.assignedPositions = ["DEF","MID","FWD"];
      }
    });

    const halfSec = 20*60;
    const plan = createSubPlan(players as any, 9, halfSec, 1, false, false, true, 0, 1, "Maximus", 5);
    console.log("subs:", plan.length);

    const onPitch = new Set(players.filter((p:any)=>p.position).map((p:any)=>p.id));
    const totals = new Map<string,number>(players.map((p:any)=>[p.id, 0]));
    const events = [...plan].sort((a:any,b:any)=>(a.half===1?a.time:halfSec+a.time)-(b.half===1?b.time:halfSec+b.time));
    let last = 0;
    for (const ev of events as any) {
      const t = ev.half===1?ev.time:halfSec+ev.time;
      onPitch.forEach(id => totals.set(id, (totals.get(id) as number)+(t-last)));
      last = t;
      onPitch.delete(ev.playerOut.id);
      onPitch.add(ev.playerIn.id);
    }
    onPitch.forEach(id => totals.set(id, (totals.get(id) as number)+(halfSec*2-last)));
    const arr = [...totals.entries()].map(([id,s])=>[id, Math.round((s as number)/60)] as const).sort((a,b)=>(b[1] as number)-(a[1] as number));
    console.table(arr);
    const vals = arr.map(([,m])=>m as number);
    console.log("spread:", Math.max(...vals)-Math.min(...vals), "min");
  });
});
