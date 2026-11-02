// Disposable real snapshot/upgrade checks. No live mappings, keys or grants.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';
import { removalHostPreflight } from './removal-host-preflight.mjs';
const report={kind:'account-recovery-witness-isolated',passed:false,releaseAuthorized:false,productionIntegration:false,checks:[]};
const owner=Principal.fromUint8Array(Uint8Array.from([1,1])),identity=Principal.fromUint8Array(Uint8Array.from([2,1]));
const base=Principal.fromUint8Array(Uint8Array.from([3,1])),g2=Principal.fromUint8Array(Uint8Array.from([4,1]));
const ok=r=>{assert.ok('Ok' in r,r.Err);return r.Ok;};
const err=r=>assert.ok('Err' in r,'Expected fail-closed refusal');
let server,pic,stage='host preflight';
try{
 assert.ok(process.env.RECOVERY_WITNESS_REPORT);assert.ok(process.env.RECOVERY_WITNESS_WASM);
 report.moduleSha256=createHash('sha256').update(readFileSync(process.env.RECOVERY_WITNESS_WASM)).digest('hex');
 report.host=removalHostPreflight();server=await startRemovalLocalServer({binary:process.env.POCKET_IC_BIN,hardTtlSeconds:240});
 pic=await PocketIc.create(server.url,{processingTimeoutMs:30000});
 const init=IDL.Record({governor:IDL.Principal,identity:IDL.Principal});
 const f=await pic.setupCanister({sender:owner,controllers:[owner],idlFactory,wasm:process.env.RECOVERY_WITNESS_WASM,arg:IDL.encode([init],[{governor:owner,identity}])});
 const a=f.actor;a.setPrincipal(owner);
 const management=async(method,input,value,output)=>IDL.decode(output,await pic.updateCall({canisterId:Principal.managementCanister(),sender:owner,method,arg:IDL.encode([input],[value])}));
 const take=async()=>{
  await pic.stopCanister({canisterId:f.canisterId,sender:owner});
  const [snapshot]=await management('take_canister_snapshot',IDL.Record({canister_id:IDL.Principal,replace_snapshot:IDL.Opt(IDL.Vec(IDL.Nat8))}),{canister_id:f.canisterId,replace_snapshot:[]},[IDL.Record({id:IDL.Vec(IDL.Nat8),taken_at_timestamp:IDL.Nat64,total_size:IDL.Nat64})]);
  await pic.startCanister({canisterId:f.canisterId,sender:owner});return snapshot.id;
 };
 const restore=async snapshot=>{
  await pic.stopCanister({canisterId:f.canisterId,sender:owner});
  await management('load_canister_snapshot',IDL.Record({canister_id:IDL.Principal,snapshot_id:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)}),{canister_id:f.canisterId,snapshot_id:snapshot,sender_canister_version:[]},[]);
  await pic.startCanister({canisterId:f.canisterId,sender:owner});
 };
 stage='record immutable full removal and both group progress';
 const removal={operation_id:'remove/1',event:{Removal:{account_id:'removed',generation:1n,inventory_digest:new Uint8Array(32).fill(1),subjects:[Principal.fromUint8Array(Uint8Array.from([5,1]))],targets:[base,g2]}}};
 const revision=ok(await a.record_removal_recovery(removal));assert.equal(revision,1n);
 assert.equal(ok(await a.record_removal_recovery({...removal,operation_id:'equivalent-retry'})),1n);
 a.setPrincipal(identity);assert.deepEqual(ok(await a.read_recovery_record(revision)),removal);a.setPrincipal(owner);
 const original=ok(await a.read_recovery_head());
 const progress=(target,phase)=>({operation_id:`${target.toText()}/${phase}`,event:{Progress:{account_id:'removed',generation:1n,progress:{[phase]:{target}}}}});
 err(await a.record_removal_recovery({operation_id:'premature-complete',event:{Progress:{account_id:'removed',generation:1n,progress:{Completed:null}}}}));
 for(const target of [base,g2])ok(await a.record_removal_recovery(progress(target,'Sealed')));
 ok(await a.record_removal_recovery({operation_id:'complete',event:{Progress:{account_id:'removed',generation:1n,progress:{Completed:null}}}}));
 const rows=ok(await a.read_recovery_records(0n,200));assert.equal(rows.length,4);
 const disable={operation_id:'disable/8',event:{Disable:{identity,generation:8n}}};
 const disableRevision=ok(await a.record_removal_recovery(disable));assert.equal(disableRevision,5n);
 assert.equal(ok(await a.record_removal_recovery(disable)),5n);
 a.setPrincipal(identity);assert.deepEqual(ok(await a.read_recovery_record(5n)),disable);a.setPrincipal(owner);
 rows.push([5n,disable]);
 assert.equal(ok(await a.record_removal_recovery(removal)),revision);
 const conflicting=structuredClone(removal);conflicting.event.Removal.generation=2n;err(await a.record_removal_recovery(conflicting));
 a.setPrincipal(base);err(await a.read_recovery_head());err(await a.record_removal_recovery(removal));a.setPrincipal(owner);
 report.checks.push('Immutable removal, both group seals, full completion, caller rejection and idempotent retries');
 const request={identity,generation:1n,recovery_epoch:original.epoch,signed_digest:Array(32).fill(3),request_id:1n,history_revision:1n,removal_generation:1n,identity_version:1n};
 a.setPrincipal(identity);err(await a.verify_production_account_read_fence(request));a.setPrincipal(owner);
 stage='real snapshot preserves replayable progress';
 const snapshot=await take();const before=ok(await a.read_recovery_head());const version=ok(await a.read_recovery_runtime_version());
 ok(await a.close_recovery_fence(before.epoch));
 await restore(snapshot);
 assert.deepEqual(ok(await a.read_recovery_records(0n,200)),rows);
 assert.ok(ok(await a.read_recovery_runtime_version())>version,'IC version must advance outside loaded application snapshot');
 a.setPrincipal(identity);err(await a.verify_production_account_read_fence(request));a.setPrincipal(owner);
 report.checks.push('Real snapshot load retains complete removal progress, advances IC version and denies restored read approval');
 stage='upgrade preserves whole journal';
 await pic.upgradeCanister({canisterId:f.canisterId,sender:owner,wasm:process.env.RECOVERY_WITNESS_WASM,arg:IDL.encode([],[])});
 assert.deepEqual(ok(await a.read_recovery_records(0n,200)),rows);
 a.setPrincipal(identity);err(await a.verify_production_account_read_fence(request));
 report.checks.push('Real upgrade retains both group progress and keeps admission closed');report.passed=true;
}catch(error){if(error.hostReport)report.host=error.hostReport;report.failure=error.name;throw error;}
finally{
 report.stage=stage;
 try{if(pic)await Promise.race([pic.tearDown(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Bounded teardown')),5000))]);}
 finally{try{if(server)await server.stop();}finally{if(process.env.RECOVERY_WITNESS_REPORT){mkdirSync(path.dirname(process.env.RECOVERY_WITNESS_REPORT),{recursive:true});writeFileSync(process.env.RECOVERY_WITNESS_REPORT,JSON.stringify(report,null,2)+'\n');}}}
}