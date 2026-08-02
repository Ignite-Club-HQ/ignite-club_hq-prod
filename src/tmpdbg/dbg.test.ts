import { describe, it } from "vitest";
import { buildEqualTimePlan, equalTimeTargetSec, type EqualTimePlayer } from "../components/pitch/planner/equalTime";
import type { PitchPosition } from "../components/pitch/PositionBadge";
const HALF=1500; const POS: PitchPosition[]=["DEF","MID","FWD","GK"];
const mk=(id:string,on:boolean,pos?:PitchPosition):EqualTimePlayer=>({id,name:id,position:on?{x:0,y:0}:null,currentPitchPosition:on?pos??"MID":undefined});
const squad=(t:number,s:number)=>{const a:EqualTimePlayer[]=[];for(let i=0;i<s;i++)a.push(mk(`p${i+1}`,true,POS[i%3]));for(let i=s;i<t;i++)a.push(mk(`p${i+1}`,false));return a;};
describe("dbg",()=>{it("9/7",()=>{
const res=buildEqualTimePlan({players:squad(9,7),teamSize:7,halfDurationSec:HALF,minShiftSec:30,chunkSec:30,noSubBeforeSec:0,noSubAfterSec:0});
const t=equalTimeTargetSec(9,7,3000);
console.log("target",t.toFixed(1));
res.projectedSec.forEach((v,k)=>console.log(k,v,(v-t).toFixed(1)));
console.log("plan",res.plan.map(p=>`${p.half}@${p.time} ${p.playerOut.id}->${p.playerIn.id}`).join("\n"));
});});
