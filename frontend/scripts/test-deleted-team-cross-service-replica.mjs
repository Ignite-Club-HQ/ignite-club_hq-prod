// Isolated PocketIC security regression. The canisters, accounts and clubs
// are synthetic; no live IC, device token, key or production ID is contacted.
import assert from 'node:assert/strict';
import {PocketIc, PocketIcServer} from '@dfinity/pic';
import {Principal} from '@icp-sdk/core/principal';
import {IDL} from '@icp-sdk/core/candid';
import {idlFactory as clubIdl} from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import {idlFactory as chatIdl} from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import {idlFactory as eventsIdl} from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';

for(const key of ['POCKET_IC_BIN','CLUB_DOMAIN_WASM','MESSAGING_DOMAIN_WASM','EVENTS_DOMAIN_WASM']) {
  assert.ok(process.env[key],key+' must be a locally-built disposable artifact');
}
const principal=n=>Principal.fromUint8Array(Uint8Array.of(n,7,11));
const owner=principal(1), u10Only=principal(2), twoTeams=principal(3), admin=principal(4), outsider=principal(5);
const clubId='disposable-deleted-team-club', deletedId='u10', liveId='u12';
const ok=value=>{assert.ok(value && 'Ok' in value,JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v));return value.Ok};
const denied=value=>assert.ok(value && 'Err' in value, 'Expected an Err instead of private records');
const team=(id,name)=>{
  const row={id,club_id:clubId,name,archived:false,is_active:true,is_shell:false,playhq_auto_create_events:false};
  for(const key of ['age_group','deleted_at_ms','description','division','folder_id','gender','logo_url','playhq_competition_id',
    'playhq_team_id','shell_claim_token','shell_claimed_at_ms','shell_claimed_by','shell_contact_email','shell_contact_name',
    'shell_invited_by','team_type']) row[key]=[];
  return row;
};
const server=await PocketIcServer.start({binPath:process.env.POCKET_IC_BIN});
let pic;
try{
  pic=await PocketIc.create(server.getUrl());
  const install=(idlFactory,wasm)=>pic.setupCanister({idlFactory,wasm,sender:owner,controllers:[owner],
    arg:IDL.encode([IDL.Principal],[owner])});
  const club=await install(clubIdl,process.env.CLUB_DOMAIN_WASM);
  const chat=await install(chatIdl,process.env.MESSAGING_DOMAIN_WASM);
  const events=await install(eventsIdl,process.env.EVENTS_DOMAIN_WASM);
  const as=(canister,who)=>{canister.actor.setPrincipal(who);return canister.actor;};
  // New trusted consensus batch method, isolated from historical frontend
  // bindings so this disposable suite can test the exact server Candid ABI.
  const chatScopeIdl=({IDL})=>IDL.Service({
    read_chat_scope_access_batch:IDL.Func([
      IDL.Principal,IDL.Vec(IDL.Text),IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text))
    ],[IDL.Variant({
      Ok:IDL.Record({
        clubs:IDL.Vec(IDL.Tuple(IDL.Text,IDL.Bool)),
        teams:IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text,IDL.Bool)),
      }),Err:IDL.Text
    })],[]),
  });
  const chatScope=pic.createActor(chatScopeIdl,club.canisterId);
  const batch=async(from,subject,clubs,teams)=>{
    chatScope.setPrincipal(from);
    return chatScope.read_chat_scope_access_batch(subject,clubs,teams);
  };
  ok(await as(club,owner).set_messaging_domain_canister(chat.canisterId));
  ok(await as(club,owner).set_events_domain_canister(events.canisterId));
  ok(await as(chat,owner).set_club_domain_canister(club.canisterId));
  ok(await as(events,owner).set_club_domain_canister(club.canisterId));

  ok(await as(club,owner).create_club(clubId,'Disposable Club','disposable-club',[],[]));
  ok(await as(club,owner).save_team(team(deletedId,'U10')));
  ok(await as(club,owner).save_team(team(liveId,'U12')));
  for(const [human,role,teamId] of [
    [u10Only,'parent',deletedId],[twoTeams,'parent',deletedId],[twoTeams,'parent',liveId],
    [admin,'club_admin',null]
  ]) ok(await as(club,owner).add_role_grant(human,clubId,role,teamId===null?[]:[teamId]));

  denied(await batch(outsider,twoTeams,[clubId],[[clubId,deletedId]]));
  denied(await batch(owner,twoTeams,[clubId],[[clubId,deletedId]]));
  denied(await batch(chat.canisterId,twoTeams,Array(65).fill(clubId),[]));
  const allowedBatch=ok(await batch(chat.canisterId,twoTeams,[clubId],[[clubId,deletedId],[clubId,liveId],[clubId,'nonexistent']]));
  assert.deepEqual(allowedBatch.clubs,[[clubId,true]]);
  assert.deepEqual(allowedBatch.teams,[[clubId,deletedId,true],[clubId,liveId,true],[clubId,'nonexistent',false]]);
  const outsiderBatch=ok(await batch(chat.canisterId,outsider,[clubId],[[clubId,liveId]]));
  assert.deepEqual(outsiderBatch.clubs,[[clubId,false]]);
  assert.deepEqual(outsiderBatch.teams,[[clubId,liveId,false]]);

  const oldChat=ok(await as(chat,owner).ensure_conversation(clubId,[deletedId],[u10Only,twoTeams,admin]));
  assert.equal(oldChat.id,deletedId);
  ok(await as(chat,u10Only).send_message(deletedId,'Disposable private U10 message','test-u10-only',[],[]));
  const before=ok(await as(chat,twoTeams).read_account_open_conversation(deletedId,25));
  assert.equal(before.page.messages.length,1,'both-team parent could read U10 prior to deletion');
  // A live U12 chat ensures unread batching preserves a second independent
  // team when the U10 authority is subsequently revoked.
  ok(await as(chat,owner).ensure_conversation(clubId,[liveId],[owner,twoTeams,admin]));
  ok(await as(chat,owner).send_message(liveId,'Disposable private U12 message','test-u12-owner',[],[]));
  const unreadBefore=await as(chat,twoTeams).read_account_my_unread_counts();
  assert.ok(unreadBefore.some(r=>r.conversation_id===deletedId && r.count>0n),
    'protected unread summary includes currently authorized U10');
  assert.ok(unreadBefore.some(r=>r.conversation_id===liveId && r.count>0n),
    'protected unread summary includes currently authorized U12');
  const beforePage=ok(await as(chat,twoTeams).read_account_list_latest_messages_page(deletedId,[],20));
  assert.equal(beforePage.messages.length,1,'first-page protected read includes authorized U10');
  const unreadAfterPage=await as(chat,twoTeams).read_account_my_unread_counts();
  assert.deepEqual(unreadAfterPage,unreadBefore,
    'read-only message pages must never mark unread conversations as read');


  const start=BigInt((await pic.getTime())+3_600_000);
  const createEvent=async(teamId,title)=>ok(await as(events,owner).create_event(
    clubId,[teamId],title,'Disposable event','training',[],[],[],[],start,start+3_600_000n,[],false,[],[]));
  const oldEvent=await createEvent(deletedId,'U10 fixture');
  const liveEvent=await createEvent(liveId,'U12 fixture');
  const beforeEvents=await as(events,twoTeams).read_account_list_events([clubId],[]);
  assert.equal(beforeEvents.some(e=>e.id===oldEvent.id),true,'U10 accessible prior to deletion');
  assert.equal(beforeEvents.some(e=>e.id===liveEvent.id),true,'U12 accessible prior to deletion');

  ok(await as(club,owner).soft_delete_team(deletedId));
  const revokedBatch=ok(await batch(chat.canisterId,twoTeams,[clubId],[[clubId,deletedId],[clubId,liveId]]));
  assert.deepEqual(revokedBatch.clubs,[[clubId,true]]);
  assert.deepEqual(revokedBatch.teams,[[clubId,deletedId,false],[clubId,liveId,true]],
    'deleted team must be revoked even for member of another team');
  const oldOnlyBatch=ok(await batch(chat.canisterId,u10Only,[clubId],[[clubId,deletedId]]));
  assert.deepEqual(oldOnlyBatch.clubs,[[clubId,false]]);
  assert.deepEqual(oldOnlyBatch.teams,[[clubId,deletedId,false]]);
  const afterInbox=ok(await as(chat,twoTeams).read_account_recent_conversations(twoTeams,10));
  assert.ok(!afterInbox.some(c=>c.conversation_id===deletedId),
    'protected ChatGPT inbox must hide deleted team thread');
  const unreadAfterDelete=await as(chat,twoTeams).read_account_my_unread_counts();
  assert.ok(!unreadAfterDelete.some(r=>r.conversation_id===deletedId),
    'revoked team must not leak through unread summary');
  assert.ok(unreadAfterDelete.some(r=>r.conversation_id===liveId && r.count>0n),
    'independent live-team unread count must survive revocation');
  const unreadOldOnly=await as(chat,u10Only).read_account_my_unread_counts();
  assert.ok(!unreadOldOnly.some(r=>r.conversation_id===deletedId),
    'former U10-only parent must not see U10 unread metadata');


  assert.equal(await as(club,owner).read_account_is_club_member(u10Only,clubId),false,
    'U10-only parent no longer club member');
  assert.equal(await as(club,owner).read_account_is_club_member(twoTeams,clubId),true,
    'parent still holds independent U12 role');
  assert.equal(await as(club,owner).read_account_is_club_member(admin,clubId),true,
    'independent club admin survives');

  for(const human of [u10Only,twoTeams,admin]){
    await assert.rejects(()=>as(chat,human).read_account_open_conversation(deletedId,25),
      /Team chat|Conversation|team|access|authority/i,'deleted team cannot disclose old chat');
    await assert.rejects(()=>as(chat,human).read_account_list_latest_messages_page(deletedId,[],20),
      /Team chat|Conversation|team|access|authority/i,
      'deleted team must not disclose protected message-history page');
    denied(await as(chat,human).open_conversation_query(deletedId,25));
  }
  const twoTeamEvents=await as(events,twoTeams).read_account_list_events([clubId],[]);
  assert.ok(!twoTeamEvents.some(e=>e.id===oldEvent.id),'deleted U10 event is hidden even from another team parent');
  assert.ok(twoTeamEvents.some(e=>e.id===liveEvent.id),'U12 event remains visible');
  const oldOnlyEvents=await as(events,u10Only).read_account_list_events([clubId],[]);
  assert.ok(!oldOnlyEvents.some(e=>e.id===oldEvent.id || e.id===liveEvent.id),'former parent denied');
  const adminEvents=await as(events,admin).read_account_list_events([clubId],[]);
  assert.ok(!adminEvents.some(e=>e.id===oldEvent.id),'club admin may not see deleted team data');
  assert.ok(adminEvents.some(e=>e.id===liveEvent.id),'club admin still sees live U12');
  denied(await as(events,twoTeams).read_account_get_event_roster(oldEvent.id));

  // Restoring a soft-deleted team does not silently resurrect revoked grants.
  ok(await as(club,owner).restore_team(deletedId));
  assert.equal(await as(club,owner).read_account_is_club_member(u10Only,clubId),false);
  await assert.rejects(()=>as(chat,u10Only).read_account_open_conversation(deletedId,25),
    /Team chat|Conversation|team|access|authority/i);
  assert.ok(!(await as(events,u10Only).read_account_list_events([clubId],[]))
    .some(e=>e.id===oldEvent.id));

  // An explicit new admission restores only the intended U10 member's access.
  ok(await as(club,owner).add_role_grant(u10Only,clubId,'parent',[deletedId]));
  const restored=ok(await as(chat,u10Only).read_account_open_conversation(deletedId,25));
  assert.equal(restored.page.messages.length,1);
  assert.ok((await as(events,u10Only).read_account_list_events([clubId],[]))
    .some(e=>e.id===oldEvent.id));
  assert.ok(!((await as(events,outsider).read_account_list_events([clubId],[]))
    .some(e=>e.id===oldEvent.id)));
  const restoredBatch=ok(await batch(chat.canisterId,u10Only,[clubId],[[clubId,deletedId]]));
  assert.deepEqual(restoredBatch.teams,[[clubId,deletedId,true]]);
  const restoredInbox=ok(await as(chat,u10Only).read_account_recent_conversations(u10Only,10));
  assert.ok(restoredInbox.some(c=>c.conversation_id===deletedId),
    'new explicit grant restores the single intended inbox conversation');
  console.log('PASS: live trusted batch caller restrictions, positive club/team access, deleted-team revocation, inbox hiding and explicit rejoin; disposable PocketIC only');
} finally {await pic?.tearDown();await server.stop();}
