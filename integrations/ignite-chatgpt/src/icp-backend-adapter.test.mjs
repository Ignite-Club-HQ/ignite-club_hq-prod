import test from "node:test";
import assert from "node:assert/strict";
import {createCallerIcpBackend} from "./icp-backend-adapter.mjs";
import {DEV_ORIGIN} from "./core.mjs";

const me="mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const clubId="club-1",teamId="team-1",chatId="chat-1";
let sends=[];
const club={
  read_my_club_memberships_indexed:async()=>({Ok:{clubs:[clubId],next:[]}}),
  read_account_execute:async(query)=>{
    const q=JSON.parse(query);
    return {rows:q.entity==="clubs"?[[{name:"id",value:{text:clubId}},{name:"name",value:{text:"Test Club"}}]]:
      [[{name:"id",value:{text:teamId}},{name:"club_id",value:{text:clubId}},{name:"name",value:{text:"U8 Rockets"}}]],hasMore:false};
  }
};
const messaging={
  read_account_list_groups_by_team:async()=>({Ok:[{
    conversation_id:chatId,name:"Team chat",kind:"team",is_member:true,
    club_id:[clubId],team_id:[teamId]}]}),
  read_account_get_group_metadata:async()=>({Ok:{conversation_id:chatId,deleted:false,admin_only_posting:false}}),
  read_account_list_latest_messages_page:async()=>({Ok:{latest_sequence:1n,next_sequence:[],messages:[
    {id:"msg-1",conversation_id:chatId,body:"Old message",sender:me,
     created_at_ms:100n,sequence:1n,edited_at_ms:[],reply_to_id:[],attachment:[]}
  ]}}),
  send_message:async(conversation,body,key,attachment,reply)=>{
    sends.push({conversation,body,key,attachment,reply});
    return {Ok:{id:"msg-2",conversation_id:conversation,body,sender:me,idempotency_key:key,created_at_ms:101n}};
  }
};
const events={read_account_list_events:async()=>[{id:"event-1",club_id:clubId,team_id:[teamId],starts_at_ms:101n,ends_at_ms:150n}]};
const group={environment:"dev",declared:true,club_id:clubId,canisters:{club:"canister-club",messaging:"canister-message",events:"canister-event"}};
const actors={"canister-club":club,"canister-message":messaging,"canister-event":events};
const session={oauthVerified:true,internetIdentityDelegationVerified:true,environment:"dev",
  derivationOrigin:DEV_ORIGIN,principal:me,actorFactory:async(cid)=>actors[cid]};
const backend=(params={})=>createCallerIcpBackend({
  listDevGroups:params.groups??(async()=>[group]),
  resolveClubPlacement:params.placement??(async()=>group)
});
const refuse=(p)=>assert.rejects(p,/access|membership|not a member|group|unverified|invalid|denied|restricted|placement|unauthorized/i);
test("adapter requires a trusted group resolver and verified caller",async()=>{
  assert.throws(()=>createCallerIcpBackend(),/resolver required/);
  const b=backend();
  await refuse(b.listMyClubs({...session,oauthVerified:false}));
  await refuse(b.listMyClubs({...session,derivationOrigin:"https://igniteclubhq.app"}));
});
test("member can read own club, team, authorized chat, history and events",async()=>{
  const b=backend();
  assert.deepEqual(await b.listMyClubs(session),[{id:clubId,name:"Test Club"}]);
  assert.equal(await b.hasClubAccess(session,clubId),true);
  assert.equal(await b.hasTeamAccess(session,clubId,teamId),true);
  assert.equal((await b.listConversations(session,clubId,teamId)).length,1);
  assert.equal(await b.hasConversationAccess(session,clubId,teamId,chatId),true);
  const history=await b.listConversationMessages(session,clubId,teamId,chatId,null,20);
  assert.equal(history.messages[0].sender,me);
  assert.equal(history.next_sequence,null);
  assert.equal((await b.listEvents(session,clubId,teamId)).length,1);
});
test("a different conversation is denied and never produces a send",async()=>{
  sends=[];
  const b=backend();
  assert.equal(await b.hasConversationAccess(session,clubId,teamId,"chat-2"),false);
  await refuse(b.sendConversationMessage(session,clubId,teamId,"chat-2","Hi","key-1"));
  assert.equal(sends.length,0);
});
test("send uses member actor, exact text, idempotency key, no retry or provisioning",async()=>{
  sends=[];
  const b=backend();
  assert.equal(await b.canPostToConversation(session,clubId,teamId,chatId),true);
  const r=await b.sendConversationMessage(session,clubId,teamId,chatId,"Hello team","key-1");
  assert.equal(r.body,"Hello team");
  assert.equal(r.sender,me);
  assert.deepEqual(sends,[{conversation:chatId,body:"Hello team",key:"key-1",attachment:[],reply:[]}]);
});
test("admin-only posting and missing policy deny a write",async()=>{
  sends=[];
  const original=messaging.read_account_get_group_metadata;
  try{
    messaging.read_account_get_group_metadata=async()=>({Ok:{conversation_id:chatId,deleted:false,admin_only_posting:true}});
    const b=backend();
    assert.equal(await b.canPostToConversation(session,clubId,teamId,chatId),false);
    await refuse(b.sendConversationMessage(session,clubId,teamId,chatId,"Blocked","key-2"));
    assert.equal(sends.length,0);
  } finally {messaging.read_account_get_group_metadata=original;}
});
test("untrusted placement cannot choose an attacker canister",async()=>{
  const b=backend({placement:async()=>({...group,club_id:"other"})});
  await refuse(b.listMyTeams(session,clubId));
  const c=backend({placement:async()=>({...group,declared:false})});
  await refuse(c.hasClubAccess(session,clubId));
});
test("missing membership index page fails closed rather than using partial auth",async()=>{
  const original=club.read_my_club_memberships_indexed;
  try{
    club.read_my_club_memberships_indexed=async()=>({Ok:{clubs:[clubId],next:["cursor"]}});
    await refuse(backend().hasClubAccess(session,clubId));
  }finally{club.read_my_club_memberships_indexed=original;}
});
