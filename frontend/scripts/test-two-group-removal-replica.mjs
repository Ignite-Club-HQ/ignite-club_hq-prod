// Complete installed two-group inventory, real identity coordinator and real
// human receivers. Identity coordination remains rehearsal; receiver production
// guards are tested separately and never imply full production authorization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProductionIdentity } from './production-removal-authorization.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { removalInstallPreflight } from './removal-install-preflight.mjs';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';
import { HUMAN_DOMAINS, validateTwoGroupInventory, validateHumanSeals, validateCompleteSeals, assertWorkerCapabilityDenied, assertRemovalFenced } from './two-group-removal-evidence.mjs';
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1),primary=p(2),alias=p(3),survivor=p(4),outsider=p(5);
const ok=r=>{assert.ok(r&&'Ok' in r,String(r?.Err));return r.Ok;};
const err=r=>assert.ok(r&&'Err' in r,'Expected explicit refusal');
// Transport failures cannot masquerade as removal evidence.
const denied=async fn=>{
 let result;
 try{result=await fn();}catch(error){
  assert.match(String(error),/Account admission denied|Account removal fenced|Identity authority unavailable|Account is not active|Account not active|Account revoked|Principal revoked/);return;
 }
 err(result);
};
const production=process.env.TWO_GROUP_RECEIVER_MODE==='production';
const candidate=production || process.env.TWO_GROUP_RECEIVER_MODE==='production-candidate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const report={schema:1,kind:'two-group-complete-removal',passed:false,
 releaseAuthorized:false,fullInventoryAcceptance:false,productionAuthorization:false,
 identityMode:production?'production':'local-rehearsal',mode:production?'signed-production':candidate?'production-receivers-rehearsal-coordinator':'local-rehearsal',checks:[],modules:{},unresolvedInfrastructure:[],completeSeals:0,terminalFencingCompletion:false};
let server,pic,stage='validate artifact inputs';
const mark=name=>report.checks.push({name,passed:true});
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
let productionIdentityWasm;
const wasm=name=>{if(name==='identity_access' && productionIdentityWasm)return productionIdentityWasm;const f=process.env[name.toUpperCase()+'_WASM'];assert.ok(f,`${name} Wasm required`);return f;};
const factory=async name=>(await import(`../src/lab/bindings/${name}/declarations/${name}.did.js`)).idlFactory;
const env=identity=>[...(candidate?[{name:'IGNITE_ACCOUNT_ADMISSION_RELEASE',value:'1'},{name:'IGNITE_ACCOUNT_REMOVAL_RELEASE',value:'1'}]:
 [{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]),{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.toText()}];
const args=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}]);
try{
 assert.ok(process.env.TWO_GROUP_REMOVAL_REPORT,'Durable test report path required');
 for(const name of [...HUMAN_DOMAINS,'identity_access','shard_router','timer_jobs','secret_workload_identity'])report.modules[name]=hash(wasm(name));
 await removalInstallPreflight({binary:process.env.POCKET_IC_BIN,wasm:process.env.REMOVAL_INSTALL_PROBE_WASM,reportPath:process.env.REMOVAL_INSTALL_REPORT});
 server=await startRemovalLocalServer({binary:process.env.POCKET_IC_BIN,hardTtlSeconds:1800});
 pic=await PocketIc.create(server.url,{fiduciary:{state:{type:'new'}},processingTimeoutMs:60000});
 const install=async(name,variables=[])=>pic.setupCanister({idlFactory:await factory(name),wasm:wasm(name),sender:governor,controllers:[governor],
  environmentVariables:variables,arg:['identity_access','shard_router'].includes(name)?args:name==='timer_jobs'?IDL.encode([],[]):IDL.encode([IDL.Principal],[governor])});
 stage='verify default production authorization is closed without independent acceptance';
 const productionIdentity=await install('identity_access');const closedIdentity=productionIdentity.actor;
 closedIdentity.setPrincipal(governor);const closedAccount=ok(await closedIdentity.register_account());
 const initialAuthorization=ok(await closedIdentity.read_production_account_authorization());
 assert.equal(initialAuthorization.generation,0n);assert.equal(initialAuthorization.approval.length,0);
 err(await closedIdentity.read_service_account(governor));err(await closedIdentity.read_linked_account(governor));
 closedIdentity.setPrincipal(outsider);err(await closedIdentity.read_production_account_authorization());err(await closedIdentity.disable_production_account_readers());
 closedIdentity.setPrincipal(governor);assert.equal(ok(await closedIdentity.disable_production_account_readers()),1n);
 await pic.upgradeCanister({canisterId:productionIdentity.canisterId,wasm:wasm('identity_access'),sender:governor,arg:args});
 const retainedAuthorization=ok(await closedIdentity.read_production_account_authorization());
 assert.equal(retainedAuthorization.generation,1n);assert.equal(retainedAuthorization.approval.length,0);
 assert.equal(ok(await closedIdentity.whoami()).id,closedAccount.id);err(await closedIdentity.read_service_account(governor));
 mark('Non-rehearsal identity denies unaccepted alias readers; authorization disable generation survives upgrade and preserves own account');
 stage='legacy unfenced notification recovery positive control';
 const legacyQueue=await install('notification_queue');legacyQueue.actor.setPrincipal(governor);
 ok(await legacyQueue.actor.enqueue('legacy',primary.toText(),'app','event','Legacy control','legacy-key'));
 assert.equal(ok(await legacyQueue.actor.claim(99999999999999n,1)).length,1);
 assert.equal(ok(await legacyQueue.actor.recover()),1);
 assert.equal(ok(await legacyQueue.actor.claim(99999999999999n,1)).length,1);
 ok(await legacyQueue.actor.acknowledge('legacy','legacy-key'));
 mark('Unfenced legacy queue recovery still resets one processing item for authenticated retry');
 stage='install real identity and inventory';
 const identity=production?await createProductionIdentity(pic,governor,root,args):await install('identity_access',[{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}]);
 if(production){productionIdentityWasm=identity.identityWasm;report.modules.identity_access=hash(productionIdentityWasm);}
 const router=await install('shard_router');const shared=await install('secret_workload_identity');
 const id=identity.actor;id.setPrincipal(governor);ok(await id.register_account());
 const groups=[];
 for(const groupId of ['base','g2']){
  const services={};
  for(const domain of HUMAN_DOMAINS)services[domain]=await install(domain,[...env(identity.canisterId),
   ...(domain==='pii_access_control'?[{name:'VETKD_KEY_NAME',value:'key_1'}]:[]),
   ...(domain==='media_blob_store'?[{name:'GOVERNOR_PRINCIPAL',value:governor.toText()}]:[])]);
  groups.push({id:groupId,services,timer:await install('timer_jobs'),club:`club-${groupId}`});
 }
 const receivers=groups.flatMap(g=>Object.values(g.services));
 for(const target of receivers){
  target.actor.setPrincipal(outsider);err(await target.actor.read_account_protection_configuration());
  target.actor.setPrincipal(identity.canisterId);const config=ok(await target.actor.read_account_protection_configuration());
  assert.equal(config.receiver.toText(),target.canisterId.toText());assert.equal(config.authority[0]?.toText(),identity.canisterId.toText());
  assert.equal(config.protocol,1);assert.equal(config.admission_required,true);assert.equal(config.removal_enabled,true);assert.equal(config.rehearsal,!candidate);
 }
 mark('All 24 receiver effective configurations authenticate identity, reject outsiders and match selected guard mode');
 if(!production)ok(await id.set_service_authorities(receivers.map(s=>s.canisterId)));
 id.setPrincipal(primary);const account=ok(await id.register_account());const challenge=ok(await id.begin_link(alias));
 id.setPrincipal(alias);ok(await id.accept_link(challenge.id));
 id.setPrincipal(survivor);const survivingAccount=ok(await id.register_account());
 id.setPrincipal(governor);
 const subnet=await pic.getCanisterSubnetId(router.canisterId);assert.ok(subnet);
 const extra=[];router.actor.setPrincipal(governor);
 for(const g of groups){
  for(const s of Object.values(g.services))s.actor.setPrincipal(governor);
  const club=g.services.club_domain.actor;
  if(!production){ok(await club.create_club(g.club,g.id,g.id,[],[]));
   for(const human of [primary,alias,survivor])ok(await club.add_role_grant(human,g.club,'club_admin',[]));}
  ok(await club.register_media_quota_store(g.services.media_blob_store.canisterId));
  for(const domain of ['messaging_domain','vault_domain','pii_access_control','media_blob_store'])
   ok(await g.services[domain].actor.set_club_domain_canister(g.services.club_domain.canisterId));
  const mapped=[...HUMAN_DOMAINS.filter(d=>d!=='media_blob_store').map(domain=>({domain,canister:g.services[domain].canisterId})),
   {domain:'timer_jobs',canister:g.timer.canisterId},{domain:'secret_workload_identity',canister:shared.canisterId}];
  let revision=await router.actor.version();
  revision=ok(await router.actor.register_group({id:g.id,target_alias:production?'mainnet':'local',domains:mapped,accepting:false,max_clubs:100,assigned_clubs:0,
   heap_budget_bytes:1000000n,heap_bytes:0n,min_cycles:1n,cycles:0n,observed_at_ns:0n,photo_store:[]},revision));
  ok(await router.actor.register_group_placement({group_id:g.id,deployment_id:production?'prod':'isolated-replica',deployment_revision:1n,host:production?'https://icp-api.io':'https://isolated.invalid',
   network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:mapped.map(d=>({...d,subnet}))},revision));
  extra.push({group_id:g.id,domain:'media_blob_store',canister:g.services.media_blob_store.canisterId,subnet});
 }
 extra.push({group_id:'base',domain:'shard_router',canister:router.canisterId,subnet});
 const revision=async()=>production?ok(await id.read_production_account_history_revision()):ok(await id.read_removal_history_manifest()).revision;
 let inventory;
 if(!production){
  ok(await id.set_club_authorities(groups.map(g=>g.services.club_domain.canisterId)));
  ok(await id.set_group_inventory_binding({registry:router.canisterId,registry_revision:await router.actor.version(),target_alias:'local',deployment_id:'isolated-replica',deployment_revision:1n,host:'https://isolated.invalid',network_kind:'public_mainnet'},await revision()));
  ok(await id.set_removal_supplemental_inventory(extra,await revision()));
  inventory=ok(await id.read_removal_inventory_evidence(await revision()));assert.equal(inventory.media.length,2);
 } else {
  const registryRevision=await router.actor.version();
  const page=ok(await router.actor.read_group_registry_page('mainnet',[registryRevision],[],64));
  inventory={groups:{binding:{registry:router.canisterId,registry_revision:registryRevision,target_alias:'mainnet',deployment_id:'prod',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'},history_revision:await revision(),
   snapshot:{revision:registryRevision,groups:page.groups.map(g=>({id:g.id,target_alias:g.target_alias,domains:g.domains})),placements:page.placements}},supplemental:extra,
   media:groups.map(g=>({club_authority:g.services.club_domain.canisterId,registry:{active:false,stores:[g.services.media_blob_store.canisterId]}}))};
 }
 mark('Real closed base/g2 registry, 24 human receivers, two timers, shared workload and supplemental router');
 stage='configure infrastructure removal receivers';
 const infra=[{name:'shard_router',s:router},{name:'secret_workload_identity',s:shared},...groups.map(g=>({name:`${g.id}/timer_jobs`,s:g.timer}))];
 for(const {s:target} of infra){
  target.actor.setPrincipal(governor);
  // Unconfigured gates refuse every fence; only the governor configures once.
  assert.equal((await target.actor.read_account_removal_authority()).length,0);
  target.actor.setPrincipal(outsider);err(await target.actor.set_account_removal_authority(identity.canisterId));
  target.actor.setPrincipal(governor);ok(await target.actor.set_account_removal_authority(identity.canisterId));
  ok(await target.actor.set_account_removal_authority(identity.canisterId));err(await target.actor.set_account_removal_authority(outsider));
  target.actor.setPrincipal(outsider);err(await target.actor.read_account_protection_configuration());
  target.actor.setPrincipal(identity.canisterId);const config=ok(await target.actor.read_account_protection_configuration());
  assert.equal(config.receiver.toText(),target.canisterId.toText());assert.equal(config.authority[0]?.toText(),identity.canisterId.toText());
  assert.equal(config.protocol,1);assert.equal(config.admission_required,false);assert.equal(config.removal_enabled,true);assert.equal(config.rehearsal,false);
  target.actor.setPrincipal(governor);
 }
 const productionTargets=[...receivers,...infra.map(x=>x.s)];
 const refreshProduction=async()=>{if(production){id.setPrincipal(governor);inventory=await identity.authorize(inventory,productionTargets);}};
 if(production){
  inventory=await identity.authorize(inventory,productionTargets,{provision:true});
  for(const g of groups){const club=g.services.club_domain.actor;club.setPrincipal(governor);ok(await club.create_club(g.club,g.id,g.id,[],[]));
   for(const human of [primary,alias,survivor])ok(await club.add_role_grant(human,g.club,'club_admin',[]));}
  report.productionAuthorization=true;report.fullInventoryAcceptance=true;
  mark('Signed inventory bootstrap and production authorization cover all 28 real targets without rehearsal');
 }
 // Positive controls: real infrastructure obligations bound to the account.
 const baseTimer=groups[0].timer.actor;baseTimer.setPrincipal(governor);ok(await baseTimer.grant_worker(alias));
 baseTimer.setPrincipal(alias);ok(await baseTimer.claim(0n,1));
 shared.actor.setPrincipal(governor);ok(await shared.actor.register_workload(primary,'removed-account-workload',['send-push-notification']));
 shared.actor.setPrincipal(primary);assert.equal((await shared.actor.verify_secret_access(primary,'send-push-notification','before-fence')).approved,true);
 for(const human of [primary,alias,survivor]){router.actor.setPrincipal(human);ok(await router.actor.read_my_owner_test_opening(production?'mainnet':'local'));}
 mark('Four infrastructure receivers configured once; alias timer worker and primary workload are real retained obligations');
 const normalizedGroups=groups.map(g=>({id:g.id,timer:g.timer.canisterId.toText(),receivers:HUMAN_DOMAINS.map(domain=>({domain,id:g.services[domain].canisterId.toText()}))}));
 stage='seed positive private records in both groups';
 for(const g of groups){
  const a=Object.fromEntries(Object.entries(g.services).map(([n,s])=>[n,s.actor]));
  a.messaging_domain.setPrincipal(governor);g.chat=ok(await a.messaging_domain.create_conversation(g.club,[],[governor,primary,alias,survivor]));
  a.messaging_domain.setPrincipal(primary);g.message=ok(await a.messaging_domain.send_message(g.chat.id,'preserved history','original',[],[]));
  a.vault_domain.setPrincipal(governor);for(const human of [primary,alias,survivor])ok(await a.vault_domain.grant_role(human,'club_admin',[g.club],[]));
  a.vault_domain.setPrincipal(primary);ok(await a.vault_domain.create_folder('folder',g.club,[],[],'Private',[],[],[],0,[],[]));
  a.competition_domain.setPrincipal(governor);g.competition=ok(await a.competition_domain.create_competition(g.club,'Kept competition','2026'));
  for(const human of [primary,alias,survivor])ok(await a.competition_domain.grant_role(human,'competition_admin',g.competition.id,[]));
  a.mini_league_domain.setPrincipal(governor);g.league=ok(await a.mini_league_domain.create_mini_league(g.club,'Kept league',[],[],5,3,10,['red','green'],true));
  for(const human of [primary,alias,survivor]){ok(await a.mini_league_domain.grant_role(human,'league_admin',g.club,[]));ok(await a.club_points_domain.grant_role(human,'club_admin',g.club,[]));}
  a.club_points_domain.setPrincipal(primary);ok(await a.club_points_domain.award_points(g.club,{User:primary.toText()},'attendance','local',7,'Kept award',[],[],[]));
  a.media_metadata.setPrincipal(primary);g.asset=ok(await a.media_metadata.register_asset(g.club,'photo','image/jpeg','checksum',`clubs/${g.club}/photo.jpg`,'private',99999999999999n));
  a.notification_queue.setPrincipal(governor);ok(await a.notification_queue.enqueue('lease',primary.toText(),'app','event','Private notice','lease-key'));
  g.lease=ok(await a.notification_queue.claim(99999999999999n,100)).find(n=>n.id==='lease');assert.ok(g.lease);
  a.pii_access_control.setPrincipal(governor);g.publicKey=DerivedPublicKey.deserialize(Uint8Array.from(await a.pii_access_control.pii_vetkey_verification_key()));
  g.keyIdentity=new TextEncoder().encode(`clubmedia:${g.club}\u001fblob`);g.plaintext=new TextEncoder().encode(`Actual ${g.id} encrypted photo`);
  g.cipher=IbeCiphertext.encrypt(g.publicKey,IbeIdentity.fromBytes(g.keyIdentity),g.plaintext,IbeSeed.random()).serialize();
  a.media_blob_store.setPrincipal(primary);g.photoPath=`clubs/${g.club}/gallery/kept.jpg`;
  const upload=ok(await a.media_blob_store.begin_upload(g.photoPath,'image/jpeg',BigInt(g.cipher.length),1));
  ok(await a.media_blob_store.put_chunk(upload,0,g.cipher));ok(await a.media_blob_store.finalize_upload(upload));
  g.readPhoto=async human=>{a.pii_access_control.setPrincipal(human);const transport=TransportSecretKey.random();
   const key=EncryptedVetKey.deserialize(Uint8Array.from(ok(await a.pii_access_control.get_club_media_vetkey(g.club,transport.publicKeyBytes())))).decryptAndVerify(transport,g.publicKey,g.keyIdentity);
   const response=await a.media_blob_store.http_request({url:`/${g.photoPath}`,method:'GET',headers:[],body:new Uint8Array()});
   assert.equal(response.status_code,200);assert.deepEqual(Uint8Array.from(response.body),g.cipher);
   assert.deepEqual(IbeCiphertext.deserialize(Uint8Array.from(response.body)).decrypt(key),g.plaintext);};
  for(const human of [primary,alias,survivor])await g.readPhoto(human);
  for(const human of [primary,alias]){a.messaging_domain.setPrincipal(human);assert.equal(ok(await a.messaging_domain.read_account_list_messages_page(g.chat.id,[],10)).messages.length,1);}
  a.club_domain.setPrincipal(primary);assert.ok((await a.club_domain.read_account_my_role_grants()).length>0);
  a.events_domain.setPrincipal(primary);assert.deepEqual(ok(await a.events_domain.read_account_list_my_viewed_event_ids([])),[]);
  a.vault_domain.setPrincipal(primary);assert.equal(ok(await a.vault_domain.read_account_get_folder('folder'))[0].id,'folder');
  a.competition_domain.setPrincipal(primary);assert.ok(ok(await a.competition_domain.read_account_list_competitions(g.club)).some(c=>c.id===g.competition.id));
  a.mini_league_domain.setPrincipal(primary);assert.equal(ok(await a.mini_league_domain.read_account_get_mini_league(g.league.id)).id,g.league.id);
  a.club_points_domain.setPrincipal(primary);assert.equal(ok(await a.club_points_domain.read_account_get_user_points(g.club,primary.toText())),7);
  a.media_metadata.setPrincipal(primary);assert.equal((await a.media_metadata.read_account_get_asset(g.asset.id))[0].id,g.asset.id);
  a.insights_domain.setPrincipal(primary);ok(await a.insights_domain.record_web_vital('LCP',12,'good','/control'));
  a.notification_queue.setPrincipal(primary);assert.equal(ok(await a.notification_queue.list_inbox(primary.toText(),[],10)).length,1);
 }
 mark('Both aliases and survivor read actual encrypted photos and retained club messages');
 // Club removal is not whole-account removal; the other club stays available.
 const base=groups[0],second=groups[1];base.services.club_domain.actor.setPrincipal(governor);
 ok(await base.services.club_domain.actor.remove_member(base.club,primary));
 base.services.messaging_domain.actor.setPrincipal(primary);
 let clubDenied=false;try{const r=await base.services.messaging_domain.actor.read_account_list_messages_page(base.chat.id,[],10);clubDenied=Boolean(r&&'Err'in r);}catch(e){assert.match(String(e),/Club chat access forbidden/);clubDenied=true;}
 assert.ok(clubDenied);await second.readPhoto(primary);
 second.services.messaging_domain.actor.setPrincipal(primary);assert.equal(ok(await second.services.messaging_domain.actor.read_account_list_messages_page(second.chat.id,[],10)).messages.length,1);
 mark('Removing one club membership preserves other-group private access');
 // Restore only the reviewed fixture grant to exercise a real pending callback.
 ok(await base.services.club_domain.actor.restore_member(base.club,primary));
 ok(await base.services.club_domain.actor.add_role_grant(primary,base.club,'club_admin',[]));
 stage='freeze complete real inventory and revoke both aliases';id.setPrincipal(governor);
 const intent=ok(await id.begin_account_removal(account.id,await revision()));
 validateTwoGroupInventory(normalizedGroups,intent.targets.map(p=>p.toText()),shared.canisterId.toText(),router.canisterId.toText());
 assert.deepEqual(new Set(intent.subjects.map(p=>p.toText())),new Set([primary.toText(),alias.toText()]));
 if(production){
  const generation=ok(await id.read_production_account_authorization()).generation;
  for(const g of groups){await g.readPhoto(survivor);g.services.messaging_domain.actor.setPrincipal(survivor);
   assert.equal(ok(await g.services.messaging_domain.actor.read_account_list_messages_page(g.chat.id,[],10)).messages.length,1);}
  assert.equal(ok(await id.read_production_account_authorization()).generation,generation);
  mark('Survivor retains real two-group photo/chat access immediately after removal starts without renewed approval');
 }
 for(const human of [primary,alias]){id.setPrincipal(human);err(await id.whoami());err(await id.register_account());}id.setPrincipal(governor);
 // Stop one receiver, observe a failed coordinator step, retain the original intent.
 const stopped=second.services.events_domain;
 await pic.stopCanister({canisterId:stopped.canisterId,sender:governor});err(await id.advance_account_removal_receiver(account.id,stopped.canisterId));
 assert.deepEqual(ok(await id.read_account_removal_intent(account.id)),intent);
 await pic.startCanister({canisterId:stopped.canisterId,sender:governor});
 // This receiver has not yet received a local fence: current identity must
 // deny both aliases despite surviving local role/resource state.
 for(const human of [primary,alias]){stopped.actor.setPrincipal(human);await denied(()=>stopped.actor.read_account_list_my_viewed_event_ids([]));}
 mark('Unreached receiver denies both aliases before its local fence is prepared');
 const seals=[];
 for(const g of groups)for(const domain of HUMAN_DOMAINS){
  const s=g.services[domain];const progress=ok(await id.advance_account_removal_receiver(account.id,s.canisterId));
  assert.equal(progress.outstanding,domain==='notification_queue'?1n:0n);
  if(domain==='notification_queue'){
   stage=`verify ${g.id} notification lease across upgrade`;
   const q=s.actor;q.setPrincipal(governor);assert.deepEqual(await q.authorize_delivery('lease','lease-key'),{Ok:false});
   assert.equal(ok(await q.recover()),0);
   assert.equal(ok(await id.advance_account_removal_receiver(account.id,s.canisterId)).outstanding,1n);
   // Retained fences must preserve the lease even with all protection flags off.
   await pic.updateCanisterSettings({canisterId:s.canisterId,sender:governor,environmentVariables:[{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}]});
   await pic.upgradeCanister({canisterId:s.canisterId,wasm:wasm(domain),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
   q.setPrincipal(identity.canisterId);const disabledConfig=ok(await q.read_account_protection_configuration());
   assert.equal(disabledConfig.admission_required,false);assert.equal(disabledConfig.removal_enabled,false);
   q.setPrincipal(governor);assert.equal(ok(await q.recover()),0);
   // Fail-closed: with protection config stripped the coordinator must refuse
   // to advance removal at all — configuration-off can never complete removal.
   const strippedRefusal=await id.advance_account_removal_receiver(account.id,s.canisterId);
   assert.match(String(strippedRefusal?.Err),/Configured rehearsal identity required/);
   await pic.updateCanisterSettings({canisterId:s.canisterId,sender:governor,environmentVariables:env(identity.canisterId)});
   await pic.upgradeCanister({canisterId:s.canisterId,wasm:wasm(domain),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
   q.setPrincipal(governor);assert.equal(ok(await q.recover()),0);
   assert.equal(ok(await id.advance_account_removal_receiver(account.id,s.canisterId)).outstanding,1n);
   // A non-worker traps; this is not a Candid Err and must not abort the suite.
   stage=`verify ${g.id} ungranted worker cannot settle notification lease`;
   q.setPrincipal(outsider);await assertWorkerCapabilityDenied(()=>q.acknowledge('lease','lease-key'));
   assert.equal(ok(await id.advance_account_removal_receiver(account.id,s.canisterId)).outstanding,1n);
   stage=`settle ${g.id} notification lease as original owner`;
   q.setPrincipal(governor);ok(await q.acknowledge('lease','lease-key'));
  }
  // Real canister sender: coordinator authenticates prepare/drain itself.
  assert.equal(ok(await id.advance_account_removal_receiver(account.id,s.canisterId)).outstanding,0n);
  // Seals are fetched as the installed identity, not accepted from report JSON.
  const actor=s.actor;actor.setPrincipal(identity.canisterId);const seal=ok(await actor.seal_account_removal({
   account_id:intent.account_id,generation:intent.generation,inventory_digest:intent.inventory_digest,subjects:intent.subjects}));
  seals.push({receiver:seal.receiver.toText(),outstanding:seal.outstanding,request:{...seal.request,subjects:seal.request.subjects.map(p=>p.toText()),inventory_digest:Array.from(seal.request.inventory_digest)}});
 }
 validateHumanSeals(normalizedGroups,{account_id:intent.account_id,generation:intent.generation,subjects:intent.subjects.map(p=>p.toText()),inventory_digest:Array.from(intent.inventory_digest)},seals);
 if(production){
  const generation=ok(await id.read_production_account_authorization()).generation;
  for(const g of groups){await g.readPhoto(survivor);g.services.vault_domain.actor.setPrincipal(survivor);
   assert.equal(ok(await g.services.vault_domain.actor.read_account_get_folder('folder'))[0].id,'folder');}
  assert.equal(ok(await id.read_production_account_authorization()).generation,generation);
  mark('Prepared/sealed progress preserves survivor access without changing the signed approval');
 }
 mark('All 24 human receivers drain both aliases; two external leases survive upgrade until authenticated settlement');
 const probes=g=>({club_domain:()=>g.services.club_domain.actor.read_account_my_role_grants(),events_domain:()=>g.services.events_domain.actor.read_account_list_my_viewed_event_ids([]),
  messaging_domain:()=>g.services.messaging_domain.actor.read_account_list_messages_page(g.chat.id,[],10),vault_domain:()=>g.services.vault_domain.actor.read_account_get_folder('folder'),
  competition_domain:()=>g.services.competition_domain.actor.read_account_list_competitions(g.club),mini_league_domain:()=>g.services.mini_league_domain.actor.read_account_get_mini_league(g.league.id),
  club_points_domain:()=>g.services.club_points_domain.actor.read_account_get_user_points(g.club,primary.toText()),media_metadata:()=>g.services.media_metadata.actor.read_account_get_asset(g.asset.id),
  insights_domain:()=>g.services.insights_domain.actor.record_web_vital('LCP',12,'good','/removed'),notification_queue:()=>g.services.notification_queue.actor.list_inbox(primary.toText(),[],10),
  pii_access_control:()=>g.services.pii_access_control.actor.get_club_media_vetkey(g.club,TransportSecretKey.random().publicKeyBytes()),media_blob_store:()=>g.services.media_blob_store.actor.begin_upload(`clubs/${g.club}/gallery/denied.jpg`,'image/jpeg',1n,1)});
 for(const g of groups)for(const domain of HUMAN_DOMAINS){
  stage=`verify persistent ${g.id}/${domain}`;const s=g.services[domain];
  for(const human of [primary,alias]){s.actor.setPrincipal(human);await denied(probes(g)[domain]);}
  await pic.upgradeCanister({canisterId:s.canisterId,wasm:wasm(domain),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  for(const human of [primary,alias]){s.actor.setPrincipal(human);await denied(probes(g)[domain]);}
 }
 await refreshProduction();
 for(const g of groups){await g.readPhoto(survivor);const chat=g.services.messaging_domain.actor;chat.setPrincipal(survivor);
  assert.equal(ok(await chat.read_account_list_messages_page(g.chat.id,[],10)).messages[0].id,g.message.id);
  ok(await chat.send_message(g.chat.id,'Survivor remains active','survivor',[],[]));
  g.services.vault_domain.actor.setPrincipal(survivor);assert.equal(ok(await g.services.vault_domain.actor.read_account_get_folder('folder'))[0].id,'folder');
 }
 mark('24 upgraded receivers still deny both aliases while survivor retains ciphertext, Vault and chat history');
 await pic.upgradeCanister({canisterId:identity.canisterId,wasm:wasm('identity_access'),sender:governor,arg:args});
 id.setPrincipal(governor);assert.deepEqual(ok(await id.read_account_removal_intent(account.id)),intent);
 assert.deepEqual(ok(await id.begin_account_removal(account.id,0n)),intent);
 id.setPrincipal(survivor);assert.equal(ok(await id.whoami()).id,survivingAccount.id);id.setPrincipal(governor);
 err(await id.set_service_authorities([]));err(await id.advance_account_removal_receiver(account.id,outsider));
 stage='drain and seal four infrastructure receivers';
 const outsiderRequest={...intent.request??{account_id:intent.account_id,generation:intent.generation,inventory_digest:intent.inventory_digest,subjects:intent.subjects}};
 for(const {s:target} of infra){target.actor.setPrincipal(outsider);err(await target.actor.prepare_account_removal(outsiderRequest));}
 const expectedOutstanding=new Map([[router.canisterId.toText(),0n],[shared.canisterId.toText(),1n],[groups[0].timer.canisterId.toText(),1n],[groups[1].timer.canisterId.toText(),0n]]);
 for(const {s:target} of infra)assert.equal(ok(await id.advance_account_removal_receiver(account.id,target.canisterId)).outstanding,expectedOutstanding.get(target.canisterId.toText()));
 // Fenced subjects are refused at every infrastructure entry point.
 baseTimer.setPrincipal(alias);await assertRemovalFenced(()=>baseTimer.claim(0n,1));
 shared.actor.setPrincipal(primary);await assertRemovalFenced(()=>shared.actor.verify_secret_access(primary,'send-push-notification','after-fence'));
 shared.actor.setPrincipal(governor);assert.equal((await shared.actor.verify_secret_access(primary,'send-push-notification','governor-after-fence')).approved,false);
 err(await shared.actor.register_workload(alias,'re-add',['send-push-notification']));
 baseTimer.setPrincipal(governor);err(await baseTimer.grant_worker(primary));
 for(const human of [primary,alias]){router.actor.setPrincipal(human);await assertRemovalFenced(()=>router.actor.read_my_owner_test_opening(production?'mainnet':'local'));}
 router.actor.setPrincipal(survivor);ok(await router.actor.read_my_owner_test_opening(production?'mainnet':'local'));
 // Seals stay refused while obligations remain; nothing is inferred from receipts.
 err(await id.verify_account_removal_seals(account.id));
 err(await id.complete_account_removal_fencing(account.id));
 err(await id.read_account_removal_completion(account.id));
 mark('Infrastructure fences deny both aliases while survivor keeps access; seals refuse retained obligations');
 baseTimer.setPrincipal(governor);assert.equal(ok(await baseTimer.revoke_fenced_account_obligations(account.id)),1n);
 shared.actor.setPrincipal(governor);ok(await shared.actor.revoke_workload(primary));
 // Upgrades preserve every infrastructure fence.
 await pic.upgradeCanister({canisterId:router.canisterId,wasm:wasm('shard_router'),sender:governor,arg:IDL.encode([],[])});
 await pic.upgradeCanister({canisterId:shared.canisterId,wasm:wasm('secret_workload_identity'),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 for(const g of groups)await pic.upgradeCanister({canisterId:g.timer.canisterId,wasm:wasm('timer_jobs'),sender:governor,arg:IDL.encode([],[])});
 for(const human of [primary,alias]){router.actor.setPrincipal(human);await assertRemovalFenced(()=>router.actor.read_my_owner_test_opening(production?'mainnet':'local'));}
 baseTimer.setPrincipal(alias);await assertRemovalFenced(()=>baseTimer.claim(0n,1));
 shared.actor.setPrincipal(primary);await assertRemovalFenced(()=>shared.actor.verify_secret_access(primary,'send-push-notification','after-upgrade'));
 for(const {s:target} of infra)assert.equal(ok(await id.advance_account_removal_receiver(account.id,target.canisterId)).outstanding,0n);
 mark('Governor settles infrastructure obligations; fences survive router, workload and timer upgrades');
 stage='verify complete 28-target seals';
 const complete=ok(await id.verify_account_removal_seals(account.id));
 report.completeSeals=validateCompleteSeals(normalizedGroups,{account_id:intent.account_id,generation:intent.generation,subjects:intent.subjects.map(p=>p.toText()),inventory_digest:Array.from(intent.inventory_digest)},
  complete.map(x=>({...x,receiver:x.receiver.toText(),request:{...x.request,subjects:x.request.subjects.map(p=>p.toText()),inventory_digest:Array.from(x.request.inventory_digest)}})),shared.canisterId.toText(),router.canisterId.toText());
 mark('Complete global seals cover all 28 frozen targets; no erasure, release or opening is implied');
 stage='persist immutable terminal fencing completion';
 id.setPrincipal(outsider);err(await id.complete_account_removal_fencing(account.id));
 id.setPrincipal(governor);
 const terminal=ok(await id.complete_account_removal_fencing(account.id));
 // Refresh only for the preceding intentional module upgrades, not completion.
 if(production){
  await refreshProduction();
  const generation=ok(await id.read_production_account_authorization()).generation;
  assert.deepEqual(ok(await id.complete_account_removal_fencing(account.id)),terminal);
  for(const g of groups)await g.readPhoto(survivor);
  assert.equal(ok(await id.read_production_account_authorization()).generation,generation);
  mark('Completed-removal retries preserve survivor reads under the unchanged signed capability');
 }
 assert.equal(terminal.targets.length,28);assert.equal(terminal.seals.length,28);
 assert.deepEqual(terminal.request,{account_id:intent.account_id,generation:intent.generation,inventory_digest:intent.inventory_digest,subjects:intent.subjects});
 const terminalRevision=await revision();
 assert.deepEqual(ok(await id.complete_account_removal_fencing(account.id)),terminal);
 assert.equal(await revision(),terminalRevision);
 await pic.upgradeCanister({canisterId:identity.canisterId,wasm:wasm('identity_access'),sender:governor,arg:args});
 assert.deepEqual(ok(await id.read_account_removal_completion(account.id)),terminal);
 assert.deepEqual(ok(await id.complete_account_removal_fencing(account.id)),terminal);
 assert.deepEqual(ok(await id.read_account_removal_intent(account.id)),intent);
 const manifest=ok(await id.read_removal_history_manifest());assert.equal(manifest.removal_completions,1n);
 const exported=ok(await id.read_removal_history_page(manifest.revision,{RemovalCompletions:[]},200));
 assert.deepEqual(exported.completions,[[account.id,terminal]]);
 err(await id.set_service_authorities(receivers.map(s=>s.canisterId)));
 for(const human of [primary,alias]){id.setPrincipal(human);err(await id.whoami());err(await id.register_account());}
 await refreshProduction();
 for(const g of groups){await g.readPhoto(survivor);g.services.messaging_domain.actor.setPrincipal(survivor);
  assert.equal(ok(await g.services.messaging_domain.actor.read_account_list_messages_page(g.chat.id,[],10)).messages.length,2);
  g.services.vault_domain.actor.setPrincipal(survivor);assert.equal(ok(await g.services.vault_domain.actor.read_account_get_folder('folder'))[0].id,'folder');}
 report.terminalFencingCompletion=true;
 mark('Immutable terminal fencing completion survives replay and identity upgrade; history, data, survivor access and authority locks remain');
 report.passed=true;
}catch(error){report.failure=error?.name??'Error';throw error;}
finally{
 report.stage=stage;
 try{if(pic)await Promise.race([pic.tearDown(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Bounded teardown')),5000))]);}
 finally{try{if(server)await server.stop();}finally{if(process.env.TWO_GROUP_REMOVAL_REPORT){mkdirSync(path.dirname(process.env.TWO_GROUP_REMOVAL_REPORT),{recursive:true});writeFileSync(process.env.TWO_GROUP_REMOVAL_REPORT,JSON.stringify(report,null,2)+'\n');}}}
}