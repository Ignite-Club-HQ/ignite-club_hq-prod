import test from "node:test";
import assert from "node:assert/strict";
import {getMyIgniteOverview} from "./overview.mjs";
import {PluginAccessError} from "./core.mjs";

const clubA = {id:"club-a",name:"Giddy Goat"}, clubB={id:"club-b",name:"Club B"};
const teamA={id:"team-a",club_id:"club-a",name:"U9"}, teamB={id:"team-b",club_id:"club-a",name:"U10"};
const event=(id,at,extra={})=>({id,club_id:"club-a",team_id:"team-a",title:id,starts_at_ms:String(at),ends_at_ms:String(at+60),...extra});
const handlers=(options={})=>({
  list_my_clubs:async()=>({clubs:options.clubs??[clubA]}),
  list_my_teams:async()=>({teams:options.teams??[teamA]}),
  list_team_events:async()=>({events:options.events??[event("later",900),event("early",200),event("old",50)]}),
  list_conversations:async()=>({conversations:options.chats??[{id:"chat-a",club_id:"club-a",team_id:"team-a",name:"Team chat"}]}),
  ...options.override,
});
const at={nowMs:100};
const denied=(promise,code)=>assert.rejects(promise,e=>e instanceof PluginAccessError && e.code===code);

test("one club and team opens home without another question and sorts future events",async()=>{
  const v=await getMyIgniteOverview(handlers(),{},null,at);
  assert.equal(v.view,"team_home");
  assert.equal(v.club.name,"Giddy Goat");
  assert.deepEqual(v.events.map(e=>e.id),["early","later"]);
  assert.equal(v.events_status,"ok");
  assert.equal(v.chats_status,"ok");
  assert.deepEqual(v.chats.map(c=>c.name),["Team chat"]);
});
test("multi-club users choose a club; do not query teams before choice",async()=>{
  const h=handlers({clubs:[clubA,clubB],override:{list_my_teams:async()=>{throw Error("Should not query teams yet")}}});
  const v=await getMyIgniteOverview(h,{},null,at);
  assert.equal(v.view,"choose_club");
  assert.equal(v.clubs.length,2);
});
test("multi-team users choose team, even when names are duplicated",async()=>{
  const h=handlers({teams:[teamA,{...teamB,name:"U9"}]});
  const v=await getMyIgniteOverview(h,{},null,at);
  assert.equal(v.view,"choose_team");
  assert.equal(v.teams.length,2);
});
test("team selection is by authorised club and team, not input principal",async()=>{
  const h=handlers({clubs:[clubA,clubB],teams:[teamA,teamB]});
  await denied(getMyIgniteOverview(h,{club_id:"forbidden"},null,at),"ACCESS_DENIED");
  await denied(getMyIgniteOverview(h,{club_id:"club-a",team_id:"forbidden"},null,at),"ACCESS_DENIED");
  await denied(getMyIgniteOverview(h,{club_id:"club-a",principal:"admin"},null,at),"INVALID_INPUT");
  await denied(getMyIgniteOverview(h,{team_id:"team-a"},null,at),"INVALID_INPUT");
});
test("no club or no team are distinct from connection failure",async()=>{
  assert.equal((await getMyIgniteOverview(handlers({clubs:[]}),{},null,at)).view,"no_clubs");
  assert.equal((await getMyIgniteOverview(handlers({teams:[]}),{},null,at)).view,"no_teams");
  await assert.rejects(getMyIgniteOverview(handlers({override:{list_my_clubs:async()=>{throw Error("AUTH_EXPIRED")}}}),{},null,at),/AUTH_EXPIRED/);
});
test("cancelled/deleted/past events do not appear as upcoming",async()=>{
  const h=handlers({events:[event("cancel",300,{cancelled:true}),event("deleted",400,{deleted:true}),event("past",90),event("soon",200)]});
  const v=await getMyIgniteOverview(h,{},null,at);
  assert.deepEqual(v.events.map(e=>e.id),["soon"]);
});
test("empty calendar is not a failure; calendar failure is not empty schedule",async()=>{
  const empty=await getMyIgniteOverview(handlers({events:[]}),{},null,at);
  assert.deepEqual(empty.events,[]);assert.equal(empty.events_status,"ok");
  const h=handlers({override:{list_team_events:async()=>{throw Error("ICP unavailable")}}});
  const v=await getMyIgniteOverview(h,{},null,at);
  assert.equal(v.events,null);assert.equal(v.events_status,"unavailable");assert.equal(v.chats_status,"ok");
});
test("conversation failure does not erase a valid schedule",async()=>{
  const v=await getMyIgniteOverview(handlers({override:{list_conversations:async()=>{throw Error("no permission")}}}),{},null,at);
  assert.equal(v.events_status,"ok");assert.equal(v.chats_status,"unavailable");assert.equal(v.chats,null);
});
test("cross-club event, cross-team chat, and malformed time cannot leak",async()=>{
  const wrongEvent=await getMyIgniteOverview(handlers({events:[event("foreign",200,{club_id:"club-other"})]}),{},null,at);
  assert.equal(wrongEvent.events_status,"unavailable");assert.equal(wrongEvent.events,null);
  const wrongChat=await getMyIgniteOverview(handlers({chats:[{id:"chat-b",club_id:"club-a",team_id:"team-other",name:"Private"}]}),{},null,at);
  assert.equal(wrongChat.chats_status,"unavailable");assert.equal(wrongChat.chats,null);
  const invalid=await getMyIgniteOverview(handlers({events:[event("invalid",'not-a-time')]}),{},null,at);
  assert.equal(invalid.events_status,"unavailable");
});
