import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { targets, loadDev, statusRequest, decodeStatus, updateRequest, verifyAfter } from './controllers.mjs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { IDL } = require('@icp-sdk/core/candid');
const { Principal } = require('@icp-sdk/core/principal');
const cfg = loadDev(); const all = targets(cfg);
const OWNER = '4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae';
const GOV = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const PUB = 'jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe';
const OP = 's53an-5aaaa-aaac5-aaaaa-cai';
const II = 'tuhjl-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe';
const FRONT = 'h2knm-vaaaa-aaac5-aadqa-cai';
// Engine-style reply with extra fields the decoder must skip.
function reply(controllers, extra = true) {
  const S = IDL.Record({ controllers: IDL.Vec(IDL.Principal), compute_allocation: IDL.Nat, memory_allocation: IDL.Nat,
    freezing_threshold: IDL.Nat, reserved_cycles_limit: IDL.Nat, log_visibility: IDL.Variant({ controllers: IDL.Null, public: IDL.Null }) });
  const R = IDL.Record({ status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }), settings: S,
    module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), memory_size: IDL.Nat, cycles: IDL.Nat, idle_cycles_burned_per_day: IDL.Nat });
  return Buffer.from(IDL.encode([R], [{ status: { running: null }, settings: { controllers: controllers.map(c => Principal.fromText(c)),
    compute_allocation: 0n, memory_allocation: 0n, freezing_threshold: 2592000n, reserved_cycles_limit: 5n, log_visibility: { controllers: null } },
    module_hash: [], memory_size: 1n, cycles: 0n, idle_cycles_burned_per_day: 0n }])).toString('hex');
}
test('config uses the corrected tuhjl identity and vk34m governor', () => {
  assert.equal(cfg.controllers.connectedIdentity, II); assert.equal(cfg.controllers.governor, GOV);
});
test('frontend gets owner + publisher only; 31 backends get owner + governor only', () => {
  assert.equal(all.length, 32);
  const f = all.filter(t => t.role === 'frontend'); assert.deepEqual(f.map(t => t.id), [FRONT]);
  assert.deepEqual(f[0].add, [OWNER, PUB]);
  const b = all.filter(t => t.role === 'backend'); assert.equal(b.length, 31);
  for (const t of b) { assert.deepEqual(t.add, [OWNER, GOV]); assert.ok(!t.add.includes(PUB)); }
});
test('status request round-trips through the official decoder', () => {
  const r = statusRequest(FRONT);
  assert.equal(IDL.decode([IDL.Record({ canister_id: IDL.Principal })], new Uint8Array(Buffer.from(r.hex, 'hex')))[0].canister_id.toText(), FRONT);
});
test('update keeps every existing controller, adds missing ones, leaves other settings null', () => {
  const u = updateRequest(all.find(t => t.id === FRONT), decodeStatus(reply([OP, II])).controllers);
  assert.deepEqual(u.after, [OP, II, OWNER, PUB]);
  const [v] = IDL.decode([IDL.Record({ canister_id: IDL.Principal, settings: IDL.Record({ controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
    freezing_threshold: IDL.Opt(IDL.Nat), wasm_memory_limit: IDL.Opt(IDL.Nat) }) })], new Uint8Array(Buffer.from(u.hex, 'hex')));
  assert.deepEqual(v.settings.controllers[0].map(x => x.toText()), [OP, II, OWNER, PUB]);
  assert.deepEqual(v.settings.freezing_threshold, []); assert.deepEqual(v.settings.wasm_memory_limit, []);
  const extra = 'aaaaa-aa';
  assert.deepEqual(updateRequest(all[1], [OP, II, extra]).after, [OP, II, extra, OWNER, GOV]);
  assert.equal(updateRequest(all[1], [OP, II, OWNER, GOV]).unchanged, true);
});
test('refuses missing retained controllers and publisher on backends', () => {
  assert.throws(() => updateRequest(all[1], [OP]), /missing/);
  assert.throws(() => updateRequest(all[1], [OP, II, PUB]), /must not control/);
});
test('verify flags removals and changed settings', () => {
  const t = all.find(x => x.id === FRONT);
  assert.equal(verifyAfter(t, decodeStatus(reply([OP, II])), decodeStatus(reply([OP, II, OWNER, PUB]))).ok, true);
  assert.equal(verifyAfter(t, decodeStatus(reply([OP, II])), decodeStatus(reply([OP, OWNER, PUB]))).ok, false);
});
