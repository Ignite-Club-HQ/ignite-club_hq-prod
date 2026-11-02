import test from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';

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