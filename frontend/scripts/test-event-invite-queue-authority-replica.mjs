// Disposable PocketIC regression for the *main* queue entry points.
// No live agent, Firebase transport, production credentials or device token.
// The authorised event invite is an in-memory local queue row only.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';

const who = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = who(1), coach = who(2), member = who(3), stranger = who(4), messenger = who(5);
const ok = r => {
  assert.ok(r && 'Ok' in r, 'Expected Ok: ' + JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
  return r.Ok;
};
const denied = r => assert.ok(r && 'Err' in r, 'Expected authorization error');
const env = ['EVENTS_DOMAIN_WASM','CLUB_DOMAIN_WASM','NOTIFICATION_QUEUE_WASM'];
for (const name of env) assert.ok(process.env[name], 'Missing local-only Wasm: ' + name);
const server = await PocketIcServer.start({binPath: process.env.POCKET_IC_BIN});
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), {processingTimeoutMs: 90_000});
  const setup = (idlFactory, wasm) => pic.setupCanister({
    idlFactory, wasm, sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Principal], [governor])
  });
  const events = await setup(eventsIdl, process.env.EVENTS_DOMAIN_WASM);
  const club = await setup(clubIdl, process.env.CLUB_DOMAIN_WASM);
  const queue = await setup(queueIdl, process.env.NOTIFICATION_QUEUE_WASM);
  const e = events.actor, c = club.actor, q = queue.actor;
  for (const {actor} of [events,club,queue]) actor.setPrincipal(governor);
  const clubId='club-event-authority', teamId='team-event-authority';
  ok(await c.create_club(clubId, 'Disposable club', 'disposable-event-security', [], []));
  const team={id:teamId,name:'Disposable team',club_id:clubId,is_active:true,is_shell:false,archived:false,playhq_auto_create_events:false};
  for (const field of ['division','gender','age_group','description','logo_url','team_type',
    'deleted_at_ms','shell_claim_token','shell_claimed_at_ms','shell_claimed_by',
    'shell_contact_email','shell_contact_name','shell_invited_by','playhq_team_id',
    'playhq_competition_id','folder_id']) team[field]=[];
  ok(await c.save_team(team));
  const acl=ok(await c.export_acl());
  const roles=[
    {user:governor,role:'club_admin',club:[clubId],team:[]},
    {user:coach,role:'coach',club:[clubId],team:[teamId]},
    {user:member,role:'player',club:[clubId],team:[teamId]},
  ];
  ok(await c.replace_acl(acl.acl_version,{...acl.acl,roles}));
  ok(await e.set_club_domain_canister(club.canisterId));
  ok(await c.set_events_domain_canister(events.canisterId));
  ok(await c.set_notification_queue_canister(queue.canisterId));

  // Missing queue club-service wiring must deny even a legitimate user/admin.
  q.setPrincipal(member);
  denied(await q.fan_out([member.toText()],clubId,'event_invite','forged','fake',[teamId]));
  denied(await q.enqueue('forged-id',member.toText(),clubId,'event_invite','forged','fake'));
  q.setPrincipal(governor);
  ok(await q.set_club_domain_canister(club.canisterId));
  ok(await q.set_messaging_domain_canister(messenger));

  const bogusKey='event_invite-evt-local-forged-invite';
  // Direct browser, coach, member, outsider, admin/governor and a configured
  // *messaging* service may not impersonate event/club authority.
  for (const caller of [coach,member,stranger,governor,messenger]) {
    q.setPrincipal(caller);
    denied(await q.fan_out([member.toText()],clubId,'event_invite','forged',bogusKey,['evt-local-forged']));
    denied(await q.enqueue('forged-'+caller.toText(),member.toText(),clubId,'event_invite','forged',bogusKey));
  }

  // Both entry points still admit their existing non-invitation workflows.
  q.setPrincipal(coach);
  assert.equal(ok(await q.fan_out([member.toText()],clubId,'membership',
    'Ordinary membership notice','member-fixture',[teamId])),1);
  const news=ok(await q.enqueue('news-fixture',member.toText(),clubId,'club_news',
    'Regular club update','news-fixture-key'));
  assert.equal(news.kind,'club_news');
  assert.equal(ok(await q.fan_out([member.toText()],clubId,'event_reminder',
    'Existing browser reminder category','reminder-fixture',[teamId])),1);

  // A real authorised event_notice traverses events -> club -> queue.
  // No device is registered: this never sends to APNs, FCM or a real user.
  const start=BigInt((await pic.getTime()) + 48*3_600_000);
  const request={
    request_id:'authorized-event',club_id:clubId,team_id:[teamId],
    title:'Authorized local training',description:'Local test only',
    event_type:'training',location:[],opponent:[],address:[],mini_league_id:[],
    rsvp_audience:['players_only'],adults_only:true,restricted_to_roles:[],
    target_team_ids:[],occurrences:[{starts_at_ms:start,ends_at_ms:start+3_600_000n}],
    duties:[],duty_team_id:[],reminder_hours:[]
  };
  e.setPrincipal(coach);
  const created=ok(await e.create_event_with_setup(request));
  const eventId=created.first_event_id;
  const canonicalKey='event_invite-'+eventId+'-invite';
  // Spoof the exact ID/key before trusted delivery: both routes must fail.
  q.setPrincipal(coach);
  denied(await q.fan_out([member.toText()],clubId,'event_invite','spoof same key',canonicalKey,[eventId]));
  denied(await q.enqueue(canonicalKey+'-'+member.toText(),member.toText(),clubId,
    'event_invite','spoof direct enqueue',canonicalKey));
  q.setPrincipal(member);
  assert.equal(ok(await q.list_inbox(member.toText(),[clubId],25)).filter(n=>n.kind==='event_invite').length,0);

  e.setPrincipal(coach);
  assert.equal(ok(await e.notify_event_audience(eventId,'event_invite')),1);
  q.setPrincipal(member);
  const notices=ok(await q.list_inbox(member.toText(),[clubId],25)).filter(n=>n.kind==='event_invite');
  assert.equal(notices.length,1,'Trusted event workflow enqueues one invite');
  assert.equal(notices[0].id,canonicalKey+'-'+member.toText());
  assert.equal(notices[0].idempotency_key,canonicalKey);
  assert.deepEqual(notices[0].related_id,[eventId]);
  assert.equal(notices[0].status.Pending,null);

  // Retries of this same event cannot send a duplicate invitation.
  e.setPrincipal(coach);
  assert.equal(ok(await e.notify_event_audience(eventId,'event_invite')),0);
  q.setPrincipal(member);
  assert.equal(ok(await q.list_inbox(member.toText(),[clubId],25)).filter(n=>n.kind==='event_invite').length,1);
  console.log('PASS: local PocketIC: both forgery methods blocked, governor/messaging excluded, legacy kinds unchanged, trusted events->club->queue invite admitted once, canonical key and duplicate safety, no device notifications.');
} finally {
  await pic?.tearDown();
  await server.stop();
}
