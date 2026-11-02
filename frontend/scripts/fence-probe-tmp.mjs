// Temporary local probe (deleted before finishing): exercises the real fencing
// helpers against a genuine PocketIC server and measures the assumption the
// fencing design rests on — that a controller handover is a detectable
// management change and that lifecycle verification survives it.
import assert from 'node:assert/strict';
import { PocketIc } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { INDEPENDENT_FENCE, assertIndependentFence, readControllerStatus, handOverControl,
  assertExclusiveController, assertRefusedWithoutControl, fenceSnapshot } from './external-controller-fencing.mjs';

const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const owner = p(1), stranger = p(3), fence = INDEPENDENT_FENCE;
assertIndependentFence(fence, [owner, stranger]);

// A minimal valid module: one exported function returning 42.
const wasm = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x08, 0x01, 0x04, 0x70, 0x69, 0x6e, 0x67, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b
]);

const server = await import('/dev-server/frontend/scripts/removal-local-supervisor.mjs')
  .then(m => m.startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 }));
const pic = await PocketIc.create(server.url, { processingTimeoutMs: 60000 });
const target = await pic.createCanister({ sender: owner, controllers: [owner] });
await pic.installCode({ canisterId: target, sender: owner, wasm, arg: new Uint8Array() });

// The same disposable reader the signed review uses: a canister calling
// canister_info, not ingress with a forged sender.
const readerFactory = ({ IDL: t }) => t.Service({
  read_lifecycle: t.Func([t.Principal], [t.Record({ total_num_changes: t.Nat64, module_hash: t.Opt(t.Vec(t.Nat8)) })], [])
});
const reader = await pic.setupCanister({ sender: owner, controllers: [owner],
  wasm: process.env.REMOVAL_LIFECYCLE_PROBE_WASM, arg: IDL.encode([], []), idlFactory: readerFactory });
reader.actor.setPrincipal(owner);
const lifecycle = async canister => {
  const info = await reader.actor.read_lifecycle(canister);
  return { changes: info.total_num_changes, module: info.module_hash[0] ? Buffer.from(info.module_hash[0]).toString('hex') : null };
};

const before = await lifecycle(target);
const statusBefore = await readControllerStatus(pic, { canisterId: target, sender: owner });
assertExclusiveController(statusBefore, owner);
const baseline = fenceSnapshot(statusBefore);
console.log('before:', { ...baseline, changes: before.changes.toString() });

const fenced = await handOverControl(pic, { canisterId: target, from: owner, to: fence });
console.log('after handover:', fenced);

const after = await lifecycle(target);
console.log('lifecycle after handover:', { changes: after.changes.toString(), moduleUnchanged: after.module === before.module });
assert.ok(after.changes > before.changes, 'Controller handover must advance the management change count');
assert.equal(after.module, before.module, 'Handover must not replace the module');
console.log('PASS: handover is detectable through independent lifecycle evidence');

const refused = async (label, attempt) => {
  const evidence = await assertRefusedWithoutControl(pic, { canisterId: target, fence, baseline, attempt });
  console.log(`PASS refused ${label}: ${evidence.refused.slice(0, 120)}`);
};
await refused('former controller re-adding itself', () =>
  pic.updateCanisterSettings({ canisterId: target, sender: owner, controllers: [owner] }));
await refused('former controller reinstalling code', () =>
  pic.reinstallCode({ canisterId: target, sender: owner, wasm, arg: new Uint8Array() }));
await refused('former controller upgrading code', () =>
  pic.upgradeCanister({ canisterId: target, sender: owner, wasm, arg: new Uint8Array() }));
await refused('stranger taking control', () =>
  pic.updateCanisterSettings({ canisterId: target, sender: stranger, controllers: [stranger] }));

let readRefused = false;
try { await readControllerStatus(pic, { canisterId: target, sender: owner }); }
catch (error) { readRefused = true; console.log('PASS refused former controller status read:', String(error?.message ?? error).slice(0, 120)); }
assert.ok(readRefused, 'Former controller must not read controller-only status');
try { await readControllerStatus(pic, { canisterId: target, sender: stranger }); assert.fail('stranger read status'); }
catch (error) { console.log('PASS refused stranger status read:', String(error?.message ?? error).slice(0, 120)); }

const restored = await handOverControl(pic, { canisterId: target, from: fence, to: owner });
console.log('restored:', restored);
assert.equal(restored.moduleHash, baseline.moduleHash);
console.log('PASS: only the fence handed control back, module unchanged');
await pic.tearDown();
await server.stop();
