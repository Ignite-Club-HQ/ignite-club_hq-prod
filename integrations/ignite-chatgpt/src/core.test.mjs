import test from "node:test";
import assert from "node:assert/strict";
import {createIgniteHandlers, invokeIgniteTool, PluginAccessError, DEV_ORIGIN, TOOL_NAMES, APP_ONLY_TOOL_NAMES, invokeIgniteAppTool} from "./core.mjs";

const principal = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const session = {oauthVerified:true, internetIdentityDelegationVerified:true,
  environment:"dev",derivationOrigin:DEV_ORIGIN, principal,actorFactory:()=>({})};
const demo = {
  getProfile: async () => ({id:principal,nickname:"Test parent",secret:"private"}),
  listMyClubs: async () => [{id:"club-1",name:"Example club",private:"secret"}],
  hasClubAccess: async (_s,club) => club === "club-1",
  hasTeamAccess: async (_s,c,t) => c === "club-1" && t === "team-1",
  hasConversationAccess: async (_s,c,t,chat) => c === "club-1" && t === "team-1" && chat === "chat-1",
  canPostToConversation: async (_s,c,t,chat) => c === "club-1" && t === "team-1" && chat === "chat-1",
  sendConversationMessage: async (session,c,t,chat,body,key) => ({id:"message-4",conversation_id:chat,body,sender:session.principal,idempotency_key:key,created_at_ms:1730000000000n}),
  listConversationMessages: async () => ({latest_sequence:3n,next_sequence:1n,messages:[
    {id:"msg-2",conversation_id:"chat-1",body:"Thanks",sender:principal,created_at_ms:200n,sequence:2n},
    {id:"msg-3",conversation_id:"chat-1",body:"Training tomorrow",sender:"other-principal",created_at_ms:300n,sequence:3n,attachment:{kind:"image",url:"private"}}
  ]}),
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

test("only the six reviewed read operations are exposed",()=>{
  assert.deepEqual(TOOL_NAMES,["get_ignite_profile","list_my_clubs","list_my_teams","list_team_events","list_conversations","list_conversation_messages"]);
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

test("history returns caller-scoped pages with ascending messages and no sender principal",async()=>{
  const h=setup();
  const page=await h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",limit:25});
  assert.equal(page.next_sequence,"1");
  assert.equal(page.latest_sequence,"3");
  assert.equal(page.messages.length,2);
  assert.equal(page.messages[0].id,"msg-2");
  assert.equal(page.messages[0].is_mine,true);
  assert.equal(page.messages[1].sender_name,"Team member");
  assert.deepEqual(page.messages[1].attachment,{kind:"image"});
  assert.equal("sender" in page.messages[1],false);
  assert.equal("idempotency_key" in page.messages[1],false);
});

test("history forbids unrelated conversation, input identity and malformed cursor",async()=>{
  const h=setup();
  await denied(h.list_conversation_messages({club_id:"club-2",team_id:"team-1",conversation_id:"chat-1"}),"ACCESS_DENIED");
  await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-2",conversation_id:"chat-1"}),"ACCESS_DENIED");
  await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-2"}),"ACCESS_DENIED");
  await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",principal}),"INVALID_INPUT");
  await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",limit:51}),"INVALID_INPUT");
  for(const cursor of ["-1","not-a-number","18446744073709551616",0]){
    await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",before_sequence:cursor}),"INVALID_INPUT");
  }
});

test("history rejects cross-conversation rows, oversized pages and duplicates",async()=>{
  const args={club_id:"club-1",team_id:"team-1",conversation_id:"chat-1"};
  const h1=setup({backend:{listConversationMessages:async()=>({messages:[{id:"msg-other",conversation_id:"chat-2",body:"hidden",sender:principal,created_at_ms:1,sequence:1}]})}});
  await denied(h1.list_conversation_messages(args),"ACCESS_DENIED");
  const h2=setup({backend:{listConversationMessages:async()=>({messages:new Array(51).fill({id:"dup",conversation_id:"chat-1",body:"hi",sender:principal,created_at_ms:1,sequence:1})})}});
  await denied(h2.list_conversation_messages(args),"INVALID_BACKEND_RESULT");
  const h3=setup({backend:{listConversationMessages:async()=>({messages:[{id:"dup",conversation_id:"chat-1",body:"a",sender:principal,created_at_ms:1,sequence:1},{id:"dup",conversation_id:"chat-1",body:"b",sender:principal,created_at_ms:2,sequence:2}]})}});
  await denied(h3.list_conversation_messages(args),"ACCESS_DENIED");
});

test("history does not accept absence of validated backend authority",async()=>{
  const h=setup({backend:{hasConversationAccess:async()=>false}});
  await denied(h.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1"}),"ACCESS_DENIED");
  const h2=setup({backend:{hasConversationAccess:undefined}});
  await denied(h2.list_conversation_messages({club_id:"club-1",team_id:"team-1",conversation_id:"chat-1"}),"NOT_AVAILABLE");
});

test("app-only Send is excluded from model tools and accepts exactly one authorized tap", async()=>{
  const calls=[];
  const h=setup({backend:{sendConversationMessage:async(session,c,t,chat,body,key)=>{
    calls.push({session,c,t,chat,body,key});
    return {id:"message-4",conversation_id:chat,body,sender:session.principal,idempotency_key:key,created_at_ms:1730000000000n};
  }}});
  assert.deepEqual(APP_ONLY_TOOL_NAMES,["send_team_message"]);
  assert.equal(TOOL_NAMES.includes("send_team_message"),false);
  const args={club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",
    body:"Please bring your boots tomorrow.",client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"};
  await denied(invokeIgniteTool(h,"send_team_message",args,{}),"UNKNOWN_TOOL");
  const res=await invokeIgniteAppTool(h,"send_team_message",args,{});
  assert.equal(res.status,"sent");
  assert.equal(res.message.body,args.body);
  assert.equal(calls.length,1);
  assert.equal(calls[0].key,principal+":"+args.client_request_id);
  assert.equal("idempotency_key" in res,false);
});
test("app-only send rejects forged principal, inappropriate conversation, blank body and invalid request IDs",async()=>{
  const h=setup();
  const good={club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",body:"Hello!",
    client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"};
  for(const supplied of [
    {...good,principal},
    {...good,club_id:"club-2"},
    {...good,team_id:"team-2"},
    {...good,conversation_id:"chat-2"},
    {...good,body:"  "},
    {...good,body:"x".repeat(2001)},
    {...good,client_request_id:"00000000-0000-0000-0000-000000000000"}
  ]) await denied(h.send_team_message(supplied),supplied.principal||supplied.body?.trim()===""||supplied.body?.length>2000||supplied.client_request_id?.startsWith("0000")?"INVALID_INPUT":"ACCESS_DENIED");
});
test("app-only send rejects posting-disabled and unverifiable replies, without retry",async()=>{
  const good={club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",body:"Hi",
    client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"};
  let calls=0;
  const h=setup({backend:{canPostToConversation:async()=>false,
    sendConversationMessage:async()=>{calls++;throw Error("must not write")}}});
  await denied(h.send_team_message(good),"ACCESS_DENIED");
  assert.equal(calls,0);
  const h2=setup({backend:{sendConversationMessage:async()=>{calls++;throw Error("Unknown outcome")}}});
  await assert.rejects(h2.send_team_message(good),/Unknown outcome/);
  assert.equal(calls,1);
  for(const wrong of [
    {conversation_id:"chat-2",body:"Hi",sender:principal},
    {conversation_id:"chat-1",body:"Changed",sender:principal},
    {conversation_id:"chat-1",body:"Hi",sender:"someone-else"}
  ]) {
    const x=setup({backend:{sendConversationMessage:async(_s,_c,_t,_ch,_body,key)=>
      ({id:"message-4",idempotency_key:key,created_at_ms:1,...wrong})}});
    await denied(x.send_team_message(good),"IDENTITY_MISMATCH");
  }
});
test("expired authorization fails closed without even attempting a send", async()=>{
  let calls=0;
  const h=setup({resolveVerifiedSession:async()=>({...session,oauthVerified:false}),
    backend:{sendConversationMessage:async()=>{calls++}}});
  await denied(h.send_team_message({
    club_id:"club-1",team_id:"team-1",conversation_id:"chat-1",body:"Hello",
    client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"
  }),"NOT_CONNECTED");
  assert.equal(calls,0);
});
