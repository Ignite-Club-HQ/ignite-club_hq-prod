import { describe, expect, it, vi } from "vitest";
import {
  assertChildSourceMatchesTeam, assertMayCreateChild, childSourceKey,
  collectVerifiedChildren, requireSourceClubCanisterId, runForVerifiedOwnedChild,
} from "./icpChildrenGroupSafety";

const g1="mzzzv-taaaa-aaaal-qxlrq-cai";
const g2="yfwyv-nyaaa-aaaal-qxpyq-cai";
const groupChild=(sourceClubCanisterId:string,id:string,name:string="")=>({
  sourceClubCanisterId,id,name,isPrimary:true,
});

describe("ICP children across club groups",()=>{
  it("preserves two same-ID children from different canisters without collision",()=>{
    const rows=collectVerifiedChildren([[groupChild(g1,"same")],[groupChild(g2,"same")]]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(childSourceKey)).size).toBe(2);
  });
  it("rejects duplicate source rows and absent canister provenance",()=>{
    expect(()=>collectVerifiedChildren([[groupChild(g1,"id"),groupChild(g1,"id")]])).toThrow("twice");
    expect(()=>requireSourceClubCanisterId({canisterIds:{}})).toThrow("no club_domain");
    expect(()=>childSourceKey({id:"id",sourceClubCanisterId:""})).toThrow("provenance");
  });
  it("blocks Group 1 child assignment to Group 2 team before writes",()=>{
    const child=groupChild(g1,"existing");
    expect(()=>assertChildSourceMatchesTeam(child,{
      id:"u10",club_id:"group2club",sourceClubCanisterId:g2,
    })).toThrow("different ICP canister groups");
    expect(()=>assertChildSourceMatchesTeam(child,{
      id:"legacy",club_id:"group1club",sourceClubCanisterId:g1,
    })).not.toThrow();
  });
  it("prevents re-creating Ted once he appears in any group's private names",()=>{
    const existing=[groupChild(g1,"own-3","Ted"),groupChild(g2,"another","Sally")];
    expect(()=>assertMayCreateChild(" ted ",existing,true)).toThrow("already appears");
    expect(()=>assertMayCreateChild("Bob",existing,true)).not.toThrow();
  });
  it("also protects guardian-linked children from duplicate creation",()=>{
    const guardian={...groupChild(g1,"g-child","Ted"),isPrimary:false};
    expect(()=>assertMayCreateChild("ted",[guardian],true)).toThrow("already appears");
    expect(()=>assertMayCreateChild("Another child",[{...guardian,name:""}],true)).toThrow("could not be confirmed");
  });
  it("fails closed when any existing private name or child inventory is unresolved",()=>{
    expect(()=>assertMayCreateChild("Ted",undefined,true)).toThrow("must be checked");
    expect(()=>assertMayCreateChild("Ted",[groupChild(g1,"x","")],true)).toThrow("could not be confirmed");
    expect(()=>assertMayCreateChild("Ted",[groupChild(g1,"x","")],false)).toThrow("must be checked");
  });
  it("selects only verified child source and verifies caller still sees that child before a mutation",async()=>{
    const action=vi.fn(async(ctx:{source:string})=>ctx.source);
    const read=vi.fn(async(ctx:{source:string},id:string)=>ctx.source===g2&&id==="owned");
    await expect(runForVerifiedOwnedChild(groupChild(g2,"owned"),[{source:g1},{source:g2}],
      ctx=>ctx.source,read,action)).resolves.toBe(g2);
    expect(action).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    const denied=vi.fn();
    await expect(runForVerifiedOwnedChild(groupChild(g1,"not-owned"),[{source:g1},{source:g2}],
      ctx=>ctx.source,read,denied)).rejects.toThrow("no longer linked");
    expect(denied).not.toHaveBeenCalled();
  });
  it("never guesses when a source is missing or listed twice",async()=>{
    const action=vi.fn();
    for(const ctxs of [[{source:g1}], [{source:g2},{source:g2}]]) {
      await expect(runForVerifiedOwnedChild(groupChild(g2,"owned"),ctxs,
        ctx=>ctx.source,async()=>true,action)).rejects.toThrow("uniquely verified");
    }
    expect(action).not.toHaveBeenCalled();
  });
});
