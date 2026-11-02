import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertCandidEqual } from './assert-candid-equal.mjs';

// PocketIC loads the CommonJS decoder; this file and the replica fixtures use
// ESM. A same-decoder roundtrip cannot reproduce distinct Principal prototypes.
const simulatorRequire=createRequire(createRequire(import.meta.url).resolve('@dfinity/pic'));
const { IDL: simulatorIDL }=simulatorRequire('@icp-sdk/core/candid');
const decodeResponse=(name,value)=>{
 const type=idlFactory({IDL:simulatorIDL})._fields.find(([n])=>n===name)?.[1].retTypes;
 assert.ok(type);
 return simulatorIDL.decode(type,simulatorIDL.encode(type,[value]))[0];
};

test('simulator removal readback compares identity bytes across ESM and CommonJS',()=>{
 const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
 const record={operation_id:'remove/1',event:{Removal:{account_id:'removed',generation:1n,inventory_digest:new Uint8Array(32).fill(1),subjects:[p(5)],targets:[p(3),p(4)]}}};
 const decoded=decodeResponse('read_recovery_record',{Ok:record}).Ok;
 assert.notEqual(Object.getPrototypeOf(decoded.event.Removal.subjects[0]),Object.getPrototypeOf(record.event.Removal.subjects[0]));
 assert.throws(()=>assert.deepEqual(decoded,record),assert.AssertionError);
 assertCandidEqual(decoded,record);
 for(const change of [
  {generation:2n}, {inventory_digest:new Uint8Array(32).fill(2)},
  {subjects:[p(6)]}, {targets:[p(4),p(3)]}, {targets:[p(3)]}, {generation:1},
 ]) assert.throws(()=>assertCandidEqual(decoded,{...record,event:{Removal:{...record.event.Removal,...change}}}),assert.AssertionError);
 assert.throws(()=>assertCandidEqual(decoded,{...record,unexpected:true}),assert.AssertionError);
 const lastByte=new Uint8Array(record.event.Removal.inventory_digest);lastByte[31]=2;
 assert.throws(()=>assertCandidEqual(decoded,{...record,event:{Removal:{...record.event.Removal,inventory_digest:lastByte}}}),assert.AssertionError);
});

test('simulator snapshot and upgrade journal retains removal, progress and disable rows exactly',()=>{
 const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
 const rows=[
  [1n,{operation_id:'remove/1',event:{Removal:{account_id:'removed',generation:1n,inventory_digest:new Uint8Array(32).fill(1),subjects:[p(5)],targets:[p(3),p(4)]}}}],
  [2n,{operation_id:'seal/3',event:{Progress:{account_id:'removed',generation:1n,progress:{Sealed:{target:p(3)}}}}}],
  [3n,{operation_id:'seal/4',event:{Progress:{account_id:'removed',generation:1n,progress:{Sealed:{target:p(4)}}}}}],
  [4n,{operation_id:'complete',event:{Progress:{account_id:'removed',generation:1n,progress:{Completed:null}}}}],
  [5n,{operation_id:'disable/8',event:{Disable:{identity:p(2),generation:8n}}}],
 ];
 const decoded=decodeResponse('read_recovery_records',{Ok:rows}).Ok;
 assertCandidEqual(decoded,rows);
 assertCandidEqual(decodeResponse('read_recovery_record',{Ok:rows[4][1]}).Ok,rows[4][1]);
 assert.throws(()=>assertCandidEqual(decoded,rows.slice(0,-1)),assert.AssertionError);
 assert.throws(()=>assertCandidEqual(decoded,[...rows].reverse()),assert.AssertionError);
});

test('simulator signed witness receipt retains exact caller and request fields',()=>{
 const identity=Principal.fromUint8Array(Uint8Array.from([2,1]));
 const request={identity,generation:1n,recovery_epoch:1n,signed_digest:new Uint8Array(32).fill(3),request_id:1n,history_revision:0n,removal_generation:0n,identity_version:1n};
 const receipt={request,witness_version:1n,journal_revision:0n,journal_digest:new Uint8Array(32)};
 const decoded=decodeResponse('verify_production_account_read_fence',{Ok:receipt}).Ok;
 assertCandidEqual(decoded.request,request);
 assert.throws(()=>assertCandidEqual(decoded.request,{...request,request_id:2n}),assert.AssertionError);
});

test('recovery record retains exact digest bytes and fields through the real Candid contract', () => {
 const service=idlFactory({IDL});
 const method=service._fields.find(([name])=>name==='record_removal_recovery')?.[1];
 assert.ok(method,'Recovery record method must exist');
 const record={operation_id:'remove/1',event:{Removal:{account_id:'removed',generation:1n,inventory_digest:new Uint8Array(32).fill(1),subjects:[Principal.fromUint8Array(Uint8Array.from([5,1]))],targets:[Principal.fromUint8Array(Uint8Array.from([3,1])),Principal.fromUint8Array(Uint8Array.from([4,1]))]}}};
 const [decoded]=IDL.decode(method.argTypes,IDL.encode(method.argTypes,[record]));
 assert.deepEqual(decoded,record);
 const changed=structuredClone(record);
 changed.event.Removal.inventory_digest[31]=2;
 assert.notDeepEqual(decoded,changed,'Changing even the last byte must remain detectable');
});

test('subject recovery requests preserve exact account, aliases and immutable baseline through Candid',()=>{
 const service=idlFactory({IDL});const method=service._fields.find(([n])=>n==='verify_production_subject_read_fence')?.[1];assert.ok(method);
 const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
 const request={request:{identity:p(2),generation:3n,recovery_epoch:4n,signed_digest:new Uint8Array(32).fill(5),request_id:6n,
  history_revision:70n,removal_generation:8n,identity_version:9n},account_id:'surviving-account',subjects:[p(10),p(11)]};
 const [decoded]=IDL.decode(method.argTypes,IDL.encode(method.argTypes,[request]));assert.deepEqual(decoded,request);
 decoded.subjects.pop();assert.notDeepEqual(decoded,request);
});

test('signed acceptance preserves exact lifecycle and journal bytes through the witness contract',()=>{
 const service=idlFactory({IDL});
 const type=service._fields.find(([name])=>name==='accept_recovery_fence')?.[1].argTypes;
 assert.ok(type);
 const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
 const digest=n=>new Uint8Array(32).fill(n);
 const body={witness:p(1),witness_version:4n,identity:p(2),epoch:1n,journal_revision:0n,journal_digest:new Uint8Array(32),inventory_digest:digest(1),decoded_history_digest:digest(2),generation:1n,signed_digest:digest(3),expires_at_ns:100n,history_revision:0n,removal_generation:0n,identity_version:1n,participants:[{canister:p(2),module:digest(4),changes:1n},{canister:p(3),module:digest(5),changes:2n}]};
 const key=generateKeyPairSync('ed25519');
 const bodyType=service._fields.find(([name])=>name==='recovery_acceptance_signing_bytes')?.[1].argTypes;
 assert.ok(bodyType);
 const payload=IDL.encode(bodyType,[body]);
 const signed={body,signature:new Uint8Array(sign(null,Buffer.from(payload),key.privateKey))};
 const [decoded]=IDL.decode(type,IDL.encode(type,[signed]));
 assert.deepEqual(decoded,signed);
 assert.ok(verify(null,Buffer.from(IDL.encode(bodyType,[decoded.body])),key.publicKey,decoded.signature));
 decoded.body.participants[1].changes=3n;
 assert.equal(verify(null,Buffer.from(IDL.encode(bodyType,[decoded.body])),key.publicKey,decoded.signature),false);
});