// Probe: does real management-canister controller fencing behave as the
// recovery design needs? Runs against a genuine local PocketIC server.
import assert from 'node:assert/strict';
import { PocketIc } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { startRemovalLocalServer } from '/dev-server/frontend/scripts/removal-local-supervisor.mjs';

const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), fence = p(2), stranger = p(3);

const server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 });
const pic = await PocketIc.create(server.url, { processingTimeoutMs: 60000 });

// A minimal valid module: one exported query returning 42.
const wasm = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x08, 0x01, 0x04, 0x70, 0x69, 0x6e, 0x67, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b
]);

const canister = await pic.createCanister({ sender: governor, controllers: [governor] });
await pic.installCode({ canisterId: canister, sender: governor, wasm, arg: new Uint8Array() });
console.log('installed canister', canister.toText());

const status = async sender => {
  const encoded = await pic.updateCall({
    canisterId: Principal.managementCanister(), sender, method: 'canister_status',
    arg: IDL.encode([IDL.Record({ canister_id: IDL.Principal })], [{ canister_id: canister }]),
  });
  return IDL.decode([IDL.Record({
    status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
    settings: IDL.Record({
      controllers: IDL.Vec(IDL.Principal), compute_allocation: IDL.Nat,
      memory_allocation: IDL.Nat, freezing_threshold: IDL.Nat,
    }),
    module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), memory_size: IDL.Nat,
  })], encoded)[0];
};

const before = await status(governor);
console.log('controller before:', before.settings.controllers.map(String), 'module_hash:', before.module_hash.length);

// 1. Governor hands exclusive control to the independent fence principal.
await pic.updateCanisterSettings({ canisterId: canister, sender: governor, controllers: [fence] });
const after = await status(fence);
console.log('controller after:', after.settings.controllers.map(String), 'module_hash unchanged:',
  JSON.stringify(after.module_hash) === JSON.stringify(before.module_hash), 'memory_size:', after.memory_size.toString());

// 2. The former controller must no longer be able to change settings.
let refused = 'NOT REFUSED';
try {
  await pic.updateCanisterSettings({ canisterId: canister, sender: governor, controllers: [governor] });
} catch (e) { refused = String(e?.message ?? e).slice(0, 160); }
console.log('former controller update_settings ->', refused);

// 3. The former controller must not be able to replace the code.
let installRefused = 'NOT REFUSED';
try {
  await pic.installCode({ canisterId: canister, sender: governor, wasm, arg: new Uint8Array() });
} catch (e) { installRefused = String(e?.message ?? e).slice(0, 160); }
console.log('former controller install_code ->', installRefused);

// 4. A stranger must not be able to read status either.
let statusRefused = 'NOT REFUSED';
try { await status(stranger); } catch (e) { statusRefused = String(e?.message ?? e).slice(0, 160); }
console.log('stranger canister_status ->', statusRefused);

// 5. Only the fence principal can hand control back.
let restoreRefused = 'NOT REFUSED';
try {
  await pic.updateCanisterSettings({ canisterId: canister, sender: stranger, controllers: [governor] });
} catch (e) { restoreRefused = String(e?.message ?? e).slice(0, 160); }
console.log('stranger restore ->', restoreRefused);
await pic.updateCanisterSettings({ canisterId: canister, sender: fence, controllers: [governor] });
console.log('restored by fence ->', (await status(governor)).settings.controllers.map(String));

await pic.tearDown();
await server.stop();
console.log('probe complete');
