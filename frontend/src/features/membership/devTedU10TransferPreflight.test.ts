import { describe, expect, it } from "vitest";
import {
  DEV_TED_U10, isDevTedU10PreviewCandidate, validateDevTedPreflight,
  type DevTedSourceReadback, type DevTedDestinationReadback,
} from "./devTedU10TransferPreflight";

const host = "proe7-kqaaa-aaaas-qg6gq-cai.icp.net";
const source = (): DevTedSourceReadback => ({
  group: DEV_TED_U10.sourceCanister, id: DEV_TED_U10.sourceChildId,
  name: "Ted", owner: DEV_TED_U10.parentPrincipal, teams: [],
  guardians: [DEV_TED_U10.parentPrincipal],
});
const destination = (): DevTedDestinationReadback => ({
  group: DEV_TED_U10.destinationCanister,
  caller: DEV_TED_U10.parentPrincipal,
  club: DEV_TED_U10.targetClubId,
  team: DEV_TED_U10.targetTeamId,
  teamName: DEV_TED_U10.expectedTeamName,
  member: true, existingChildIds: [],
});
describe("DEV Ted U10 transfer read-only preflight", () => {
  it("returns a non-write-authorising verified source/target preview", () => {
    expect(validateDevTedPreflight(host,[source()],destination())).toEqual({
      sourceChildId:DEV_TED_U10.sourceChildId,
      sourceCanister:DEV_TED_U10.sourceCanister,
      targetCanister:DEV_TED_U10.destinationCanister,
      targetClubId:DEV_TED_U10.targetClubId,
      targetTeamId:DEV_TED_U10.targetTeamId,
      name:"Ted",parentPrincipal:DEV_TED_U10.parentPrincipal,
      destinationEmpty:true,writeAuthorised:false,
    });
  });
  it("never surfaces the action outside the pinned DEV host and exact owned child", () => {
    const child={ id:DEV_TED_U10.sourceChildId,sourceClubCanisterId:DEV_TED_U10.sourceCanister,
      name:"Ted",isPrimary:true };
    expect(isDevTedU10PreviewCandidate(host,child)).toBe(true);
    expect(isDevTedU10PreviewCandidate("igniteclubhq.com",child)).toBe(false);
    expect(isDevTedU10PreviewCandidate(host,{...child,isPrimary:false})).toBe(false);
    expect(isDevTedU10PreviewCandidate(host,{...child,id:"a different child"})).toBe(false);
    expect(isDevTedU10PreviewCandidate(host,{...child,sourceClubCanisterId:DEV_TED_U10.destinationCanister})).toBe(false);
    expect(() => validateDevTedPreflight("igniteclubhq.com",[source()],destination())).toThrow("Ignite DEV");
  });
  it.each([
    ["source absent",[],/uniquely verified/],
    ["two source rows",[source(),source()],/uniquely verified/],
    ["wrong source id",[{...source(),id:"wrong"}],/pinned source/],
    ["wrong group",[{...source(),group:DEV_TED_U10.destinationCanister}],/pinned source/],
    ["wrong owner",[{...source(),owner:"other-principal"}],/primary Parent/],
    ["unreadable name",[{...source(),name:null}],/encrypted name/],
    ["changed name",[{...source(),name:"Other"}],/encrypted name/],
    ["source team assigned",[{...source(),teams:["g1-team"]}],/source team/],
    ["missing guardian",[{...source(),guardians:[]}],/guardian relationship/],
    ["additional guardian",[{...source(),guardians:[DEV_TED_U10.parentPrincipal,"other"]}],/guardian relationship/],
  ] as const)("%s stops before any move",(_reason,rows,rejection)=>{
    expect(()=>validateDevTedPreflight(host,rows as unknown as readonly DevTedSourceReadback[],destination())).toThrow(rejection);
  });
  it.each([
    ["wrong destination canister",{group:DEV_TED_U10.sourceCanister}],
    ["wrong signed-in parent",{caller:"another"}],
    ["wrong club",{club:"another"}],
    ["wrong team",{team:"another"}],
    ["wrong team name",{teamName:"another"}],
    ["no membership",{member:false}],
    ["destination child already exists",{existingChildIds:["child-id"]}],
  ] as const)("%s blocks move",(_reason,delta)=>{
    expect(()=>validateDevTedPreflight(host,[source()],Object.assign(destination(),delta))).toThrow();
  });
});
