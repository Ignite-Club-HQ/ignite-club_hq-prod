// Disposable local replica only. PROD identity address is allocated locally to
// exercise the actual PROD-only policy; no live network or credentials used.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PocketIc } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { matchingProdSettings } from '../../scripts/prod-settings-promotion-policy.mjs';
import { PROD_CHECK_IDS } from '../../scripts/prod-connection-check-policy.mjs';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';
import { assertCandidEqual } from './assert-candid-equal.mjs';
const p=n=>Principal.fromUint8Array(new Uint8Array([n,1]));
const governor=p(1),member=p(2),stranger=p(3);
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=Object.fromEntries(['CLUB_DOMAIN','EVENTS_DOMAIN','IDENTITY_ACCESS','SHARD_ROUTER'].map(n=>{
  assert.ok(process.env[n+'_WASM'],n+' Wasm required');return [n,readFileSync(process.env[n+'_WASM'])];
}));
const report={schema:1,kind:'isolated-prod-settings-repair',passed:false,releaseAuthorized:false,liveEventsAccepted:false,
  wasmHashes:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,hash(bytes)])),stage:'host preflight'};
const reportPath=process.env.PROD_SETTINGS_REPLICA_REPORT;
assert.ok(reportPath,'PROD_SETTINGS_REPLICA_REPORT required');
const writeReport=()=>{mkdirSync(path.dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};
let pic, server, primary;
try {
  report.host=removalHostPreflight();
  server=await startRemovalLocalServer({binary:process.env.POCKET_IC_BIN,hardTtlSeconds:600});
  report.binaryVersion=server.version;
  pic=await PocketIc.create(server.url,{processingTimeoutMs:180_000});
  report.stage='install real identity';
  const setup=(idlFactory,wasm,extra={})=>pic.setupCanister({idlFactory,wasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor]),...extra});
  const identity=await setup(identityIdl,files.IDENTITY_ACCESS,{targetCanisterId:Principal.fromText(PROD_CHECK_IDS.identity_access),environmentVariables:[{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}],arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  console.log('Local identity installed');
  report.stage='install real router, club and events';
  const router=await setup(routerIdl,files.SHARD_ROUTER,{arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  console.log('Local router installed');
  const club=await setup(clubIdl,files.CLUB_DOMAIN),events=await setup(eventsIdl,files.EVENTS_DOMAIN);
  const a=club.actor,e=events.actor,id=identity.actor;
  for(const actor of [a,e,id,router.actor]) actor.setPrincipal(governor);
  ok(await a.create_club('retained-club','Retained club','retained',[],[]));
  const team={id:'retained-team',name:'Retained team',club_id:'retained-club',is_active:true,is_shell:false,archived:false,playhq_auto_create_events:false};
  for(const field of ['division','gender','age_group','description','logo_url','team_type','deleted_at_ms','shell_claim_token','shell_claimed_at_ms','shell_claimed_by','shell_contact_email','shell_contact_name','shell_invited_by','playhq_team_id','playhq_competition_id','folder_id']) team[field]=[];
  ok(await a.save_team(team));
  const acl=ok(await a.export_acl());
  ok(await a.replace_acl(acl.acl_version,{...acl.acl,roles:[{user:governor,role:'club_admin',club:['retained-club'],team:[]},{user:member,role:'coach',club:['retained-club'],team:['retained-team']}]}));
  ok(await e.set_club_domain_canister(club.canisterId));
  ok(await a.set_events_domain_canister(events.canisterId));
  e.setPrincipal(member);
  const start=BigInt(await pic.getTime())+86_400_000n;
  const event=ok(await e.create_event('retained-club',['retained-team'],'Retained event','Before repair','training',[],[],[],[],start,start+3_600_000n,[],true,[],[]));
  report.stage='seed retained event and role records';
  const beforeEvents=await e.read_account_list_events(['retained-club'],['retained-team']);
  assert.equal(beforeEvents.length,1);
  a.setPrincipal(member);const beforeRoles=await a.read_account_my_role_grants();assert.ok(beforeRoles.length);
  id.setPrincipal(member);const account=ok(await id.register_account());
  id.setPrincipal(stranger);ok(await id.register_account());
  // Grant actual production eligibility from the real pinned router. Other
  // destination addresses are metadata, not all-service acceptance evidence.
  const names=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
  const group={id:'g2',target_alias:'mainnet',domains:names.map((domain,i)=>({domain,canister:domain==='club_domain'?club.canisterId:domain==='events_domain'?events.canisterId:p(40+i)})),photo_store:[p(90)],accepting:false,max_clubs:10,assigned_clubs:0,heap_budget_bytes:1_000_000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n};
  const subnet=await pic.getCanisterSubnetId(identity.canisterId);assert.ok(subnet);
  let revision=ok(await router.actor.register_group(group,await router.actor.version()));
  revision=ok(await router.actor.register_group_placement({group_id:'g2',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:group.domains.map(d=>({...d,subnet}))},revision));
  const binding={registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'};
  id.setPrincipal(governor);ok(await id.pin_owner_test_deletion_registry(binding));ok(await id.authorize_group2_admission(binding));
  const broken=[{name:'IGNITE_ACCOUNT_ADMISSION_RELEASE',value:'1'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()},{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE',value:'1'}];
  const upgrade=async(service,wasm)=>pic.upgradeCanister({canisterId:service.canisterId,wasm,sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  report.stage='reproduce conflicting settings';
  for(const [service,wasm] of [[club,files.CLUB_DOMAIN],[events,files.EVENTS_DOMAIN]]) {
    await pic.updateCanisterSettings({canisterId:service.canisterId,sender:governor,environmentVariables:broken});await upgrade(service,wasm);
  }
  // Use submit/await directly so trapped callbacks reject reliably.
  const call=async(factory,service,subject,method,args=[])=>{
    const signature=factory({IDL})._fields.find(([n])=>n===method)?.[1];assert.ok(signature);
    const message=await pic.client.submitCall({canisterId:service.canisterId,sender:subject,method,payload:new Uint8Array(IDL.encode(signature.argTypes,args))});
    const response=await pic.client.awaitCall(message);return IDL.decode(signature.retTypes,response.body)[0];
  };
  await assert.rejects(()=>call(clubIdl,club,member,'read_account_list_my_personal_teams'),/Conflicting account protection configuration/);
  await assert.rejects(()=>call(eventsIdl,events,member,'read_account_list_events',[['retained-club'],['retained-team']]),/Conflicting account protection configuration/);
  console.log('PASS reproduced exact protection conflict on real club and events code.');
  report.conflictReproduced=true;
  report.stage='repair and verify identical-code upgrades';
  const repaired=matchingProdSettings(broken,identity.canisterId.toText());assert.equal(repaired.changed,true);
  for(const [service,wasm] of [[club,files.CLUB_DOMAIN],[events,files.EVENTS_DOMAIN]]) {
    await pic.updateCanisterSettings({canisterId:service.canisterId,sender:governor,environmentVariables:repaired.next});
    await upgrade(service,wasm);
    const status=await pic.canisterStatus({canisterId:service.canisterId,sender:governor});
    assert.ok(status.moduleHash,'Installed module hash required');
    assert.equal(Buffer.from(status.moduleHash).toString('hex'),hash(wasm));
    assert.deepEqual(status.settings.environmentVariables,repaired.next);
    const env=new Map(status.settings.environmentVariables.map(r=>[r.name,r.value]));
    assert.equal(env.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL'),'0');assert.equal(env.get('IGNITE_ACCOUNT_ADMISSION_RELEASE'),'1');
    assert.equal(env.get('VETKD_KEY_NAME'),'key_1');assert.equal(env.get('IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE'),'1');
  }
  report.stage='verify retained data and access denials';
  assertCandidEqual(await call(eventsIdl,events,member,'read_account_list_events',[['retained-club'],['retained-team']]),beforeEvents);
  assertCandidEqual(await call(clubIdl,club,member,'read_account_my_role_grants'),beforeRoles);
  assert.deepEqual(ok(await call(clubIdl,club,member,'read_account_list_my_personal_teams')),[]);
  assert.deepEqual(await call(eventsIdl,events,stranger,'read_account_list_events',[['retained-club'],['retained-team']]),[]);
  assert.deepEqual(ok(await call(eventsIdl,events,member,'read_account_list_events_multi',[['retained-club'],['retained-team']])).map(r=>r.id),[event.id]);
  ok(await id.set_account_status(account.id,{Suspended:null}));
  await assert.rejects(()=>call(eventsIdl,events,member,'read_account_list_events',[['retained-club'],['retained-team']]),/Account admission denied or unavailable/);
  await assert.rejects(()=>call(clubIdl,club,member,'read_account_my_role_grants'),/Account admission denied or unavailable/);
  ok(await id.set_account_status(account.id,{Active:null}));
  assertCandidEqual(await call(eventsIdl,events,member,'read_account_list_events',[['retained-club'],['retained-team']]),beforeEvents);
  assert.equal(ok(await router.actor.list_groups())[0].accepting,false);
  console.log('PASS real replica: repaired production admission; retained full event and role records; same Wasm and switches; foreign visibility and suspension denials; restoration and closed group preserved. No live acceptance claimed.');
  report.stage='passed';report.passed=true;
} catch(error) {primary=error;if(error.hostReport)report.host=error.hostReport;} finally {
  await finishRemovalLocalTest({pic,server,report,primaryError:primary,writeReport});
}