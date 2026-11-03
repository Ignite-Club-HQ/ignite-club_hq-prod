// Real production identity/witness transport, not full reader or controller acceptance.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc } from '@dfinity/pic';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as witnessFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { idlFactory as identityFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';
import { assertCandidEqual } from './assert-candid-equal.mjs';
import { createLocalLifecycleReader } from './removal-local-lifecycle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const report={kind:'production-identity-recovery-transport-isolated',passed:false,
 identityMode:'production',productionAuthorization:false,fullInventoryAcceptance:false,
 externalControllerFencing:false,releaseAuthorized:false,checks:[],modules:{}};
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const owner=p(1),human=p(2),outsider=p(3);
const ok=r=>{assert.ok(r&&'Ok' in r,String(r?.Err));return r.Ok;};
const refuses=(r,reason)=>{assert.ok(r&&'Err' in r,'Expected explicit refusal');assert.match(r.Err,reason);};
const bytes=n=>new Uint8Array(32).fill(n);
const mark=name=>report.checks.push({name,passed:true});
let server,pic,stage='host preflight';
try {
 assert.ok(process.env.PRODUCTION_RECOVERY_REPORT,'Evidence destination required');
 report.host=removalHostPreflight();
 server=await startRemovalLocalServer({binary:process.env.POCKET_IC_BIN,hardTtlSeconds:900});
 pic=await PocketIc.create(server.url,{processingTimeoutMs:60000});allowLongUpdates(pic);
 const identityId=await pic.createCanister({sender:owner,controllers:[owner]});
 const witnessId=await pic.createCanister({sender:owner,controllers:[owner]});
 // Ephemeral local keys; private keys are neither logged nor stored in artifacts.
 const approvalKey=generateKeyPairSync('ed25519'),recoveryKey=generateKeyPairSync('ed25519');
 const publicHex=k=>k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
 stage='build isolated immutable public pins';
 const target=path.join(root,'target/isolated-production-recovery');
 execFileSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','recovery_witness'],{
  cwd:root,timeout:360000,stdio:['ignore','ignore','pipe'],env:{...process.env,
   CARGO_TARGET_DIR:target,IGNITE_PRODUCTION_ACCOUNT_WITNESS:witnessId.toText(),
   IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY:publicHex(approvalKey),
   IGNITE_RECOVERY_APPROVER_PUBLIC_KEY:publicHex(recoveryKey)}});
 // Witness first: identity pins its exact program fingerprint and sole controller.
 const witnessPinHash=(await import('node:crypto')).createHash('sha256').update((await import('node:fs')).readFileSync(path.join(target,'wasm32-unknown-unknown/release/recovery_witness.wasm'))).digest('hex');
 execFileSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','identity_access'],{
  cwd:root,timeout:360000,stdio:['ignore','ignore','pipe'],env:{...process.env,
   CARGO_TARGET_DIR:target,IGNITE_PRODUCTION_ACCOUNT_WITNESS:witnessId.toText(),IGNITE_PRODUCTION_ACCOUNT_WITNESS_MODULE_HASH:witnessPinHash,IGNITE_PRODUCTION_ACCOUNT_WITNESS_CONTROLLER:owner.toText(),
   IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY:publicHex(approvalKey),
   IGNITE_RECOVERY_APPROVER_PUBLIC_KEY:publicHex(recoveryKey)}});
 const wasm=name=>path.join(target,'wasm32-unknown-unknown/release',`${name}.wasm`);
 for(const name of ['identity_access','recovery_witness'])report.modules[name]=createHash('sha256').update(readFileSync(wasm(name))).digest('hex');
 const identityArgs=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor:owner}]);
 await pic.installCode({canisterId:identityId,sender:owner,wasm:wasm('identity_access'),arg:identityArgs});
 await pic.installCode({canisterId:witnessId,sender:owner,wasm:wasm('recovery_witness'),arg:IDL.encode([IDL.Record({governor:IDL.Principal,identity:IDL.Principal})],[{governor:owner,identity:identityId}])});
 const id=pic.createActor(identityFactory,identityId),w=pic.createActor(witnessFactory,witnessId);
 id.setPrincipal(human);const account=ok(await id.register_account());
 id.setPrincipal(owner);w.setPrincipal(owner);
 refuses(await id.set_service_authorities([witnessId]),/Service admission not released/);
 refuses(await id.set_club_authorities([witnessId]),/Cross-group account lifecycle not released/);
 refuses(await id.read_service_account(human),/Service admission not released/);
 mark('Real identity has immutable test pins and rejects rehearsal-only setters and unapproved reads');
 const management=async(method,input,value,output)=>IDL.decode(output,await pic.updateCall({canisterId:Principal.managementCanister(),sender:owner,method,arg:IDL.encode([input],[value])}));
 stage='verify isolated inter-canister lifecycle evidence';
 const lifecycle=await createLocalLifecycleReader(pic,owner);
 mark('Owner-only disposable reader obtains real module and change-count evidence and detects upgrades');
 const snapshot=async canister=>{
  await pic.stopCanister({canisterId:canister,sender:owner});
  const [s]=await management('take_canister_snapshot',IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))}),{canister_id:canister,replace_snapshot:[]},[IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64})]);
  await pic.startCanister({canisterId:canister,sender:owner});return s.id;
 };
 const restore=async(canister,snapshot_id)=>{
  await pic.stopCanister({canisterId:canister,sender:owner});
  await management('load_canister_snapshot',IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)}),{canister_id:canister,snapshot_id,sender_canister_version:[]},[]);
  await pic.startCanister({canisterId:canister,sender:owner});
 };
 stage='positive signed witness acceptance with live participants';
 // A third real actor provides distinct lifecycle evidence; no fixture permissions.
 const participant=await pic.createCanister({sender:owner,controllers:[owner]});
 await pic.installCode({canisterId:participant,sender:owner,wasm:wasm('identity_access'),arg:identityArgs});
 const head=ok(await w.read_recovery_head());
 const body={witness:witnessId,witness_version:ok(await w.read_recovery_runtime_version()),identity:identityId,
  epoch:head.epoch,journal_revision:head.revision,journal_digest:head.digest,
  inventory_digest:bytes(1),decoded_history_digest:bytes(2),generation:1n,signed_digest:bytes(3),
  expires_at_ns:BigInt(await pic.getTime()+120000)*1000000n,history_revision:0n,removal_generation:0n,identity_version:ok(await id.read_production_account_runtime_version()),
  participants:[await lifecycle(identityId),await lifecycle(participant)]};
 const signBody=async b=>({body:b,signature:new Uint8Array(sign(null,Buffer.from(ok(await w.recovery_acceptance_signing_bytes(b))),recoveryKey.privateKey))});
 const signed=await signBody(body);
 const request={identity:identityId,generation:1n,recovery_epoch:head.epoch,signed_digest:bytes(3),request_id:1n,history_revision:0n,removal_generation:0n,identity_version:body.identity_version};
 w.setPrincipal(identityId);refuses(await w.verify_production_account_read_fence(request),/Recovery remains fenced/);w.setPrincipal(owner);
 const forged={...signed,signature:new Uint8Array(64)};refuses(await w.accept_recovery_fence(forged),/Independent recovery signature required/);
 assert.equal(ok(await w.accept_recovery_fence(signed)),head.epoch);
 w.setPrincipal(identityId);assertCandidEqual(ok(await w.verify_production_account_read_fence(request)).request,request);
 for(const [field,value] of [['generation',2n],['history_revision',1n],['removal_generation',1n],['identity_version',body.identity_version+1n],['request_id',0n]])refuses(await w.verify_production_account_read_fence({...request,[field]:value}),/Current exact recovery fence required/);
 w.setPrincipal(outsider);refuses(await w.verify_production_account_read_fence(request),/Current exact recovery fence required/);w.setPrincipal(owner);
 mark('Signed live witness acceptance succeeds; forged signatures, wrong callers and stale request fields fail');
 // Ordinary updates and callbacks must not invalidate independently signed lifecycle pins.
 const subjectRequest={request,account_id:'survivor',subjects:[human]};
 w.setPrincipal(owner);
 const progressSignature=new Uint8Array(sign(null,Buffer.from(ok(await w.subject_progress_approval_signing_bytes(body))),recoveryKey.privateKey));
 ok(await w.authorize_subject_removal_progress({body,signature:progressSignature}));
 for(let i=0;i<3;i++) {
  ok(await w.read_recovery_head());ok(await w.read_recovery_records(0n,200));
  assert.equal(ok(await w.read_recovery_runtime_version()),body.witness_version);
  w.setPrincipal(identityId);
  assertCandidEqual(ok(await w.verify_production_account_read_fence(request)).request,request);
  assertCandidEqual(ok(await w.verify_production_subject_read_fence(subjectRequest)).request,subjectRequest);
  w.setPrincipal(owner);
 }
 mark('Repeated ordinary updates and callbacks preserve both general and subject acceptance');
 stage='accepted snapshot restoration closes old approval';
 const witnessSnapshot=await snapshot(witnessId);
 const current=ok(await w.read_recovery_head());ok(await w.close_recovery_fence(current.epoch));
 await restore(witnessId,witnessSnapshot);
 w.setPrincipal(identityId);refuses(await w.verify_production_account_read_fence(request),/Witness restored or upgraded/);w.setPrincipal(owner);
 w.setPrincipal(identityId);refuses(await w.verify_production_subject_read_fence(subjectRequest),/Subject recovery baseline restored/);w.setPrincipal(owner);
 refuses(await w.accept_recovery_fence(signed),/Current exact independent recovery acceptance required/);
 mark('Real accepted witness snapshot cannot revive prior approval after restoration');
 stage='real identity disable call journals through independent witness';
 const identitySnapshot=await snapshot(identityId);
 assert.equal(ok(await id.disable_production_account_readers()),1n);
 const disableRows=ok(await w.read_recovery_records(0n,200));assert.equal(disableRows.length,1);
 assert.equal(disableRows[0][1].event.Disable.identity.toText(),identityId.toText());
 assert.equal(disableRows[0][1].event.Disable.generation,1n);
 mark('Production identity writes and reads back a disable record through real inter-canister calls');
 stage='interrupted disable retains generation and pending record';
 await pic.stopCanister({canisterId:witnessId,sender:owner});
 refuses(await id.disable_production_account_readers(),/Recovery write outcome unknown; pending intent retained/);
 assert.equal(ok(await id.read_production_account_authorization()).generation,2n);
 await pic.startCanister({canisterId:witnessId,sender:owner});
 assert.equal(ok(await id.disable_production_account_readers()),2n);
 const retained=ok(await w.read_recovery_records(0n,200));assert.equal(retained.length,2);
 assert.equal(retained[1][1].event.Disable.generation,2n);
 mark('Unavailable witness leaves local disable immediate and retry acknowledges the same generation');
 stage='restore identity while independent disable progress remains';
 await restore(identityId,identitySnapshot);
 assertCandidEqual(ok(await w.read_recovery_records(0n,200)),retained);
 refuses(await id.read_service_account(human),/Service admission not released/);
 id.setPrincipal(human);assert.equal(ok(await id.whoami()).id,account.id);id.setPrincipal(owner);
 await pic.upgradeCanister({canisterId:identityId,sender:owner,wasm:wasm('identity_access'),arg:identityArgs});
 assertCandidEqual(ok(await w.read_recovery_records(0n,200)),retained);
 mark('Identity restore/upgrade cannot erase independent disable progress and preserves the other user account');
 // Further positive acceptance: lifecycle changes and expiry remain live refusals.
 stage='fresh acceptance rejects participant upgrade and expiry';
 w.setPrincipal(owner);const freshHead=ok(await w.read_recovery_head());
 const freshBody={...body,epoch:freshHead.epoch,journal_revision:freshHead.revision,journal_digest:freshHead.digest,
  witness_version:ok(await w.read_recovery_runtime_version()),identity_version:ok(await id.read_production_account_runtime_version()),participants:[await lifecycle(identityId),await lifecycle(participant)],expires_at_ns:BigInt(await pic.getTime()+120000)*1000000n};
 ok(await w.accept_recovery_fence(await signBody(freshBody)));
 const freshRequest={...request,recovery_epoch:freshHead.epoch,identity_version:freshBody.identity_version};
 w.setPrincipal(identityId);ok(await w.verify_production_account_read_fence(freshRequest));
 await pic.upgradeCanister({canisterId:participant,sender:owner,wasm:wasm('identity_access'),arg:identityArgs});
 refuses(await w.verify_production_account_read_fence(freshRequest),/Recovery participant lifecycle changed/);
 await pic.setTime(Number(freshBody.expires_at_ns/1000000n)+1);
 refuses(await w.verify_production_account_read_fence(freshRequest),/Current exact recovery fence required/);
 mark('Previously successful witness reads reject real participant upgrades and expired acceptance');
 stage='same-Wasm witness upgrade cannot retain either acceptance';
 await pic.upgradeCanister({canisterId:witnessId,sender:owner,wasm:wasm('recovery_witness'),arg:IDL.encode([],[])});
 refuses(await w.verify_production_subject_read_fence(subjectRequest),/Subject recovery baseline restored/);
 w.setPrincipal(owner);refuses(await w.accept_recovery_fence(signed),/Current exact independent recovery acceptance required/);
 mark('Same-Wasm witness upgrade clears v2 arming and refuses old signed acceptance');
 report.passed=true;
} catch(error) {
 if(error.hostReport)report.host=error.hostReport;
 report.failure=error.name;throw error;
} finally {
 report.stage=stage;
 try {if(pic)await Promise.race([pic.tearDown(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Bounded teardown')),5000))]);}
 finally {try {if(server)await server.stop();} finally {
  if(process.env.PRODUCTION_RECOVERY_REPORT){mkdirSync(path.dirname(process.env.PRODUCTION_RECOVERY_REPORT),{recursive:true});writeFileSync(process.env.PRODUCTION_RECOVERY_REPORT,JSON.stringify(report,null,2)+'\n');}
 }}
}