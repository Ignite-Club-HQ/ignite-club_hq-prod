import test from 'node:test';
import assert from 'node:assert/strict';
import { Principal } from '@icp-sdk/core/principal';
import { decodeLocalLifecycle, createLocalLifecycleReader } from './removal-local-lifecycle.mjs';

const canister=Principal.fromUint8Array(new Uint8Array([1,1]));
test('lifecycle evidence preserves module bytes and Nat64 counts beyond Number precision',()=>{
 const module=new Uint8Array(32).fill(7),changes=9007199254740993n;
 assert.deepEqual(decodeLocalLifecycle(canister,{module_hash:[module],total_num_changes:changes}),{canister,module,changes});
});
test('missing or malformed module evidence fails closed',()=>{
 for(const module_hash of [[],[new Uint8Array(31)],[new Uint8Array(33)],[Array(32).fill(7)],[new Uint8Array(32),new Uint8Array(32)]])
  assert.throws(()=>decodeLocalLifecycle(canister,{module_hash,total_num_changes:1n}));
});
test('malformed and out-of-range lifecycle counts fail closed',()=>{
 for(const total_num_changes of [1, '1', -1n, 18446744073709551616n])
  assert.throws(()=>decodeLocalLifecycle(canister,{module_hash:[new Uint8Array(32)],total_num_changes}));
});
test('local reader rejects generic live transport before creating any canister',async()=>{
 let called=false;
 await assert.rejects(createLocalLifecycleReader({setupCanister(){called=true;}},canister),/Owned PocketIC instance required/);
 assert.equal(called,false);
});