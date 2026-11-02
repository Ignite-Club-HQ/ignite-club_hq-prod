// Isolated-only composition. Ephemeral pins never enter deployment artifacts.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as identityFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as witnessFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
const ok=r=>{assert.ok(r&&'Ok'in r,String(r?.Err));return r.Ok;};
const digest=value=>new Uint8Array(createHash('sha256').update(value).digest());
const hex=k=>k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
export async function createProductionIdentity(pic,governor,root,args) {
 const identityId=await pic.createCanister({sender:governor,controllers:[governor]});
 const witnessId=await pic.createCanister({sender:governor,controllers:[governor]});
 const approvalKey=generateKeyPairSync('ed25519'),recoveryKey=generateKeyPairSync('ed25519');
 const target=path.join(root,'target/isolated-full-production');
 execFileSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','identity_access','-p','recovery_witness'],{
  cwd:root,timeout:360000,stdio:['ignore','ignore','pipe'],env:{...process.env,CARGO_TARGET_DIR:target,
   IGNITE_PRODUCTION_ACCOUNT_WITNESS:witnessId.toText(),IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY:hex(approvalKey),IGNITE_RECOVERY_APPROVER_PUBLIC_KEY:hex(recoveryKey)}});
 const identityWasm=path.join(target,'wasm32-unknown-unknown/release/identity_access.wasm');
 await pic.installCode({canisterId:identityId,sender:governor,wasm:identityWasm,arg:args});
 await pic.installCode({canisterId:witnessId,sender:governor,wasm:path.join(target,'wasm32-unknown-unknown/release/recovery_witness.wasm'),
  arg:IDL.encode([IDL.Record({governor:IDL.Principal,identity:IDL.Principal})],[{governor,identity:identityId}])});
 const actor=pic.createActor(identityFactory,identityId),witness=pic.createActor(witnessFactory,witnessId);
 actor.setPrincipal(governor);witness.setPrincipal(governor);
 const management=async(method,input,value,output)=>IDL.decode(output,await pic.updateCall({canisterId:Principal.managementCanister(),sender:governor,method,arg:IDL.encode([input],[value])}));
 const lifecycle=async canister=>{
  const [info]=await management('canister_info',IDL.Record({canister_id:IDL.Principal,num_requested_changes:IDL.Opt(IDL.Nat64)}),{canister_id:canister,num_requested_changes:[0n]},[IDL.Record({total_num_changes:IDL.Nat64,module_hash:IDL.Opt(IDL.Vec(IDL.Nat8))})]);
  assert.equal(info.module_hash.length,1);return {canister,changes:info.total_num_changes,module_hash:info.module_hash[0]};
 };
 const runtimeVersion=async()=>{
  const [status]=await management('canister_status',IDL.Record({canister_id:IDL.Principal}),{canister_id:identityId},[IDL.Record({canister_version:IDL.Nat64})]);
  return status.canister_version;
 };
 const signed=async body=>({body,signature:new Uint8Array(sign(null,Buffer.from(ok(await actor.production_account_approval_signing_bytes(body))),approvalKey.privateKey))});
 const authorize=async(inventory,targets,{provision=false}={})=>{
  actor.setPrincipal(governor);witness.setPrincipal(governor);
  const revision=ok(await actor.read_production_account_history_revision());
  inventory={...inventory,groups:{...inventory.groups,history_revision:revision}};
  const rows=await Promise.all([...targets.map(s=>s.canisterId),identityId].map(lifecycle));
  // Candid sorts principal order by raw bytes, not textual representation.
  const ordered=xs=>xs.slice().sort((a,b)=>Buffer.compare(Buffer.from(a.canister.toUint8Array()),Buffer.from(b.canister.toUint8Array())));
  const expectation={identity:identityId,inventory,modules:rows.map(l=>[l.canister,l.module_hash])};
  const configs=[];
  for(const target of targets){target.actor.setPrincipal(identityId);configs.push(ok(await target.actor.read_account_protection_configuration()));target.actor.setPrincipal(governor);}
  const readers=targets.filter(s=>configs.find(c=>c.receiver.toText()===s.canisterId.toText())?.admission_required).map(s=>s.canisterId);
  const sortP=xs=>xs.slice().sort((a,b)=>Buffer.compare(Buffer.from(a.toUint8Array()),Buffer.from(b.toUint8Array())));
  let review={inventory,eligibility_readers:sortP(readers),account_readers:sortP(readers),targets:sortP(targets.map(s=>s.canisterId)),lifecycle:ordered(rows),
   configurations:configs.slice().sort((a,b)=>Buffer.compare(Buffer.from(a.receiver.toUint8Array()),Buffer.from(b.receiver.toUint8Array()))),release_authorized:false,recovery_accepted:false};
  const state=ok(await actor.read_production_account_authorization());const head=ok(await witness.read_recovery_head());
  const body={kind:provision?'ignite-production-account-inventory-v1':'ignite-production-account-protection-v1',identity:identityId,operator:governor,
   generation:state.generation+1n,expires_at_ns:BigInt(await pic.getTime()+3600000)*1000000n,expectation,review,
   original_inventory_evidence:digest(Buffer.from(IDL.encode([identityFactory({IDL})._fields.find(([n])=>n==='production_account_approval_signing_bytes')[1].argTypes[0]._fields.find(([n])=>n==='expectation')[1]],[expectation]))),
   runtime_evidence:digest(Buffer.from('isolated actual services; not production provenance')),fenced_recovery_evidence:digest(Buffer.from('isolated owner-controlled backup recovery')),recovery_epoch:head.epoch};
  if(provision){
   const receipt=await signed(body);
   assert.ok('Err'in await actor.provision_production_account_inventory({...receipt,signature:new Uint8Array(64)}));
   const result=ok(await actor.provision_production_account_inventory(receipt));assert.equal(result,revision+1n);
   assert.equal(ok(await actor.provision_production_account_inventory(receipt)),result);
   return authorize({...inventory,groups:{...inventory.groups,history_revision:result}},targets);
  }
  review=ok(await actor.review_production_account_protection(expectation,revision));
  const approval=await signed({...body,review});
  const signing=ok(await actor.production_account_approval_signing_bytes(approval.body));
  const requestDigest=digest(Buffer.concat([Buffer.from(signing),Buffer.from(approval.signature)]));
  const history=ok(await actor.read_production_account_history_revision());
  const removalGeneration=ok(await actor.read_production_account_removal_generation());
  const acceptance={witness:witnessId,witness_version:ok(await witness.read_recovery_runtime_version()),identity:identityId,epoch:head.epoch,
   journal_revision:head.revision,journal_digest:head.digest,inventory_digest:body.original_inventory_evidence,
   decoded_history_digest:digest(Buffer.from(JSON.stringify(ok(await witness.read_recovery_records(0n,200)),(_,v)=>typeof v==='bigint'?v.toString():v))),
   generation:approval.body.generation,signed_digest:requestDigest,expires_at_ns:body.expires_at_ns,history_revision:history,
   removal_generation:removalGeneration,identity_version:await runtimeVersion(),participants:rows.map(l=>({canister:l.canister,module:l.module_hash,changes:l.changes}))};
  const recoverySignature=new Uint8Array(sign(null,Buffer.from(ok(await witness.recovery_acceptance_signing_bytes(acceptance))),recoveryKey.privateKey));
  ok(await witness.accept_recovery_fence({body:acceptance,signature:recoverySignature}));
  assert.ok('Err'in await actor.authorize_production_account_readers({...approval,signature:new Uint8Array(64)}));
  assert.equal(ok(await actor.authorize_production_account_readers(approval)),approval.body.generation);
  actor.setPrincipal(governor);return inventory;
 };
 return {actor,canisterId:identityId,witness,witnessId,identityWasm,authorize};
}