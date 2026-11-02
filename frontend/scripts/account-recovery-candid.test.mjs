import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

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