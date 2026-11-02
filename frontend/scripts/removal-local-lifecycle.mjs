// PocketIC-only evidence adapter. No HttpAgent or live deployment transport.
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { PocketIc } from '@dfinity/pic';

export function decodeLocalLifecycle(canister, info) {
 assert.equal(info?.module_hash?.length, 1, 'Installed participant module required');
 const module = info.module_hash[0];
 assert.ok(module instanceof Uint8Array && module.length === 32, 'Exact module SHA-256 required');
 assert.ok(typeof info.total_num_changes === 'bigint' && info.total_num_changes >= 0n && info.total_num_changes <= 0xffffffffffffffffn, 'Exact Nat64 lifecycle count required');
 return {canister, module, changes:info.total_num_changes};
}

export async function createLocalLifecycleReader(pic, owner) {
 assert.ok(pic instanceof PocketIc, 'Owned PocketIC instance required; no live transport');
 assert.notEqual(owner.toText(), '2vxsx-fae', 'Authenticated local owner required');
 assert.ok(process.env.REMOVAL_LIFECYCLE_PROBE_WASM, 'Disposable lifecycle reader Wasm required');
 const factory=({IDL:types})=>types.Service({read_lifecycle:types.Func([types.Principal],[types.Record({total_num_changes:types.Nat64,module_hash:types.Opt(types.Vec(types.Nat8))})],[])});
 const fixture=await pic.setupCanister({sender:owner,controllers:[owner],wasm:process.env.REMOVAL_LIFECYCLE_PROBE_WASM,
  arg:IDL.encode([],[]),idlFactory:factory});
 fixture.actor.setPrincipal(owner);
 const read=async canister=>decodeLocalLifecycle(canister,await fixture.actor.read_lifecycle(canister));
 await assert.rejects(pic.updateCall({canisterId:Principal.managementCanister(),sender:owner,method:'canister_info',
  arg:IDL.encode([IDL.Record({canister_id:IDL.Principal,num_requested_changes:IDL.Opt(IDL.Nat64)})],[{canister_id:fixture.canisterId,num_requested_changes:[0n]}])}),/Only canisters can call/);
 // Exercise genuine consensus evidence and unauthorized access before signing.
 const first=await read(fixture.canisterId);
 const participant=await pic.setupCanister({sender:owner,controllers:[owner],wasm:process.env.REMOVAL_LIFECYCLE_PROBE_WASM,
  arg:IDL.encode([],[]),idlFactory:factory});
 assert.deepEqual((await pic.getControllers(participant.canisterId)).map(p=>p.toText()),[owner.toText()]);
 assert.deepEqual((await read(participant.canisterId)).module,first.module);
 fixture.actor.setPrincipal();
 await assert.rejects(fixture.actor.read_lifecycle(fixture.canisterId),/Isolated lifecycle reader owner required/);
 fixture.actor.setPrincipal(owner);
 // Motoko 1.16 compiles with enhanced orthogonal persistence; upgrades must keep memory explicitly.
 await pic.upgradeCanister({canisterId:fixture.canisterId,sender:owner,wasm:process.env.REMOVAL_LIFECYCLE_PROBE_WASM,arg:IDL.encode([],[]),
  upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 const after=await read(fixture.canisterId);
 assert.deepEqual(after.module,first.module);
 assert.ok(after.changes>first.changes,'Real upgrade must advance management lifecycle');
 return read;
}