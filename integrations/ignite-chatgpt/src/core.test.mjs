import test from "node:test";
import assert from "node:assert/strict";
import {createIgniteHandlers, invokeIgniteTool, PluginAccessError, DEV_ORIGIN, TOOL_NAMES} from "./core.mjs";

const principal = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const session = {oauthVerified:true, internetIdentityDelegationVerified:true,
  environment:"dev",derivationOrigin:DEV_ORIGIN, principal,actorFactory:()=>({})};
const demo = {
  getProfile: async () => ({id:principal,nickname:"Test parent",secret:"private"}),
  listMyClubs: async () => [{id:"club-1",name:"Example club",private:"secret"}],
  hasClubAccess: async (_s,club) => club === "club-1",
  hasTeamAccess: async (_s,c,t) => c === "club-1" && t === "team-1",
  listMyTeams: async () => [{id:"team-1",name:"Juniors",club_id:"club-1",private:"secret"}, {id:"team-2",name:"Other",club_id:"club-2"}],
  listEvents: async () => [
    {id:"event-1",title:"Training",club_id:"club-1",team_id:"team-1",starts_at_ms:100,ends_at_ms:200,event_type:"training"},
    {id:"event-2",title:"Hidden",club_id:"club-2",team_id:"team-1",starts_at_ms:100,ends_at_ms:200},
    {id:"event-3",title:"Deleted",club_id:"club-1",team_id:"team-1",deleted:true,starts_at_ms:100,ends_at_ms:200},
  ],
  listConversations: async () => [
    {conversation_id:"chat-1",club_id:"club-1",team_id:"team-1",kind:"team",name:"Team chat",members:["secret"]},
    {conversation_id:"chat-2",club_id:"club-2",team_id:"team-1",kind:"team",name:"Forbidden"},
  ],
};
const setup=(config={})=>createIgniteHandlers({
  resolveVerifiedSession: config.resolveVerifiedSession??(async()=>session),
  backend:{...demo,...config.backend},
});
const denied=async(p,code)=>assert.rejects(p,(e)=>e instanceof PluginAccessError && e.code===code);

test("only the five reviewed read operations are exposed",()=>{
  assert.deepEqual(TOOL_NAMES,["get_ignite_profile","list_my_clubs","list_my_teams","list_team_events","list_conversations"]);
  assert.equal(TOOL_NAMES.some(n=>/send|write|create|delete|register|upgrade|subscribe/.test(n)),false);
});
test("reject unverified OAuth, II delegation, PROD and wrong derivation origin",async()=>{
  for(const change of [
    {oauthVerified:false},{internetIdentityDelegationVerified:false},
    {environment:"prod"},{derivationOrigin:"https://igniteclubhq.app"},
    {principal:null},{actorFactory:null}
  ]){
    const h=setup({resolveVerifiedSession:async()=>({...session,...change})});
    await denied(h.list_my_clubs({}),"NOT_CONNECTED");
  }
});
test("reject identity/principal injection in tool input",async()=>{
  const h=setup();
  for(const supplied of [{principal},{caller:principal},{user_id:principal},{environment:"prod"},{account_id:principal}]){
    await denied(h.list_my_clubs(supplied),"INVALID_INPUT");
    await denied(h.get_ignite_profile(supplied),"INVALID_INPUT");
  }
  await denied(h.list_my_teams({club_id:"club-1",principal}),"INVALID_INPUT");
  await denied(h.list_team_events({club_id:"club-1",team_id:"team-1",as_admin:true}),"INVALID_INPUT");
});
test("never accept profile from a different identity",async()=>{
  const h=setup({backend:{getProfile:async()=>({id:"someone-else"})}});
  await denied(h.get_ignite_profile({}),"IDENTITY_MISMATCH");
});
test("return minimal projected profile, clubs and teams",async()=>{
  const h=setup();
  assert.deepEqual(await h.get_ignite_profile({}),{id:principal,nickname:"Test parent"});
  assert.deepEqual(await h.list_my_clubs({}),{clubs:[{id:"club-1",name:"Example club"}]});
  assert.deepEqual(await h.list_my_teams({club_id:"club-1"}),{club_id:"club-1",teams:[{id:"team-1",club_id:"club-1",name:"Juniors"}]});
});
test("deny cross-club and cross-team access before backend data listing",async()=>{
  const h=setup();
  await denied(h.list_my_teams({club_id:"club-2"}),"ACCESS_DENIED");
  await denied(h.list_team_events({club_id:"club-1",team_id:"team-2"}),"ACCESS_DENIED");
  await denied(h.list_conversations({club_id:"club-2"}),"ACCESS_DENIED");
  await denied(h.list_conversations({club_id:"club-1",team_id:"team-2"}),"ACCESS_DENIED");
});
test("events and conversations project only authorised club/team records",async()=>{
  const h=setup();
  const events=await h.list_team_events({club_id:"club-1",team_id:"team-1"});
  assert.deepEqual(events.events,[{id:"event-1",title:"Training",club_id:"club-1",team_id:"team-1",starts_at_ms:"100",ends_at_ms:"200",event_type:"training"}]);
  const chats=await h.list_conversations({club_id:"club-1",team_id:"team-1"});
  assert.deepEqual(chats.conversations,[{id:"chat-1",name:"Team chat",club_id:"club-1",team_id:"team-1",kind:"team"}]);
});
test("unknown actions and malformed IDs fail closed",async()=>{
  const h=setup();
  await denied(invokeIgniteTool(h,"send_message",{},{}),"UNKNOWN_TOOL");
  await denied(h.list_my_teams({club_id:""}),"INVALID_INPUT");
  await denied(h.list_team_events({club_id:"club-1",team_id:"../../etc/passwd"}),"INVALID_INPUT");
});
test("backends and auth adapter errors are not silently interpreted as empty permissions",async()=>{
  const h=setup({backend:{hasClubAccess:async()=>{throw Error("ICP authority unavailable");}}});
  await assert.rejects(h.list_my_teams({club_id:"club-1"}),/ICP authority unavailable/);
  const h2=setup({resolveVerifiedSession:async()=>null});
  await denied(h2.list_my_clubs({}),"NOT_CONNECTED");
});
