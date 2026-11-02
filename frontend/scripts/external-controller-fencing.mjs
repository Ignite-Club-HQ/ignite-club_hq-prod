// Real management-canister controller fencing evidence.
//
// Every call here travels through the IC management canister (ic00) as genuine
// ingress, the same path dfx and production release tooling use. PocketIC's
// private getControllers endpoint is deliberately never used: it does not exist
// on the real network, so it could never prove controller enforcement.
import assert from 'node:assert/strict';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';

const STATUS_TYPE = IDL.Record({
  status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
  settings: IDL.Record({
    controllers: IDL.Vec(IDL.Principal),
    compute_allocation: IDL.Nat,
    memory_allocation: IDL.Nat,
    freezing_threshold: IDL.Nat,
  }),
  module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  memory_size: IDL.Nat,
});

// Deterministic, distinct from every operator, authority, witness or participant
// principal used by the isolated suites (those are built from bytes [n, 1]).
export const INDEPENDENT_FENCE = Principal.fromUint8Array(Uint8Array.from([0x7f, 0x7f]));

export function assertIndependentFence(fence, participants) {
  if (!(fence instanceof Principal)) throw new Error('Independent fence must be a real principal');
  if (fence.isAnonymous()) throw new Error('Anonymous fence would grant control to everyone');
  const seen = new Set(participants.map(p => p.toText()));
  if (seen.has(fence.toText())) throw new Error('Fence principal must not be an operator, authority, witness or participant');
  return true;
}

// Genuine canister_status readback: on the real network this is only answerable
// by a controller, so a successful reply is itself evidence of control.
export async function readControllerStatus(pic, { canisterId, sender }) {
  const reply = await pic.updateCall({
    canisterId: Principal.managementCanister(), sender, method: 'canister_status',
    arg: IDL.encode([IDL.Record({ canister_id: IDL.Principal })], [{ canister_id: canisterId }]),
  });
  return IDL.decode([STATUS_TYPE], reply)[0];
}

export function fenceSnapshot(status) {
  return {
    controllers: status.settings.controllers.map(p => p.toText()),
    moduleHash: status.module_hash[0] ? Buffer.from(status.module_hash[0]).toString('hex') : null,
    running: 'running' in status.status,
    memorySize: status.memory_size.toString(),
  };
}

export function assertExclusiveController(status, expected) {
  assert.deepEqual(status.settings.controllers.map(p => p.toText()), [expected.toText()],
    'Exactly one independent controller required');
  return fenceSnapshot(status);
}

// Exclusive handover: the old controller names the fence as its only controller,
// then the fence itself reads the result back over the management canister.
export async function handOverControl(pic, { canisterId, from, to }) {
  await pic.updateCanisterSettings({ canisterId, sender: from, controllers: [to] });
  return assertExclusiveController(await readControllerStatus(pic, { canisterId, sender: to }), to);
}

// Legitimate management work — the handover itself — is recorded in the target's
// own history, so live memory measured before fencing is not a valid comparison
// point for a refusal. A refusal must instead leave memory exactly as the reading
// taken immediately before it found it.
export function assertSettledSnapshot(before, after) {
  assert.equal(after.moduleHash, before.moduleHash, 'Repeated controller reads must agree on the module');
  assert.equal(after.memorySize, before.memorySize, 'Repeated controller reads must agree on live memory');
  return after;
}

// Two reads with nothing between them: if even that moves, live memory cannot be
// used as a refusal signal and the test must say so instead of blaming a refusal.
export async function settledControllerStatus(pic, { canisterId, fence }) {
  const first = assertExclusiveController(await readControllerStatus(pic, { canisterId, sender: fence }), fence);
  return assertSettledSnapshot(first,
    assertExclusiveController(await readControllerStatus(pic, { canisterId, sender: fence }), fence));
}

// A refusal only counts when the fence it should not have moved is still exactly
// where it was: a transport error or an unrelated rejection proves nothing. The
// original module fingerprint must survive, and the refused call must not alter
// the live memory the fence had just measured.
export async function assertRefusedWithoutControl(pic, { canisterId, fence, moduleHash, attempt }) {
  const baseline = await settledControllerStatus(pic, { canisterId, fence });
  let message;
  try { await attempt(); }
  catch (error) { message = String(error?.message ?? error).slice(0, 300); }
  if (message === undefined) throw new Error('Non-controller management call unexpectedly succeeded');
  const after = assertExclusiveController(await readControllerStatus(pic, { canisterId, sender: fence }), fence);
  assert.equal(after.moduleHash, moduleHash, 'Refused call must not replace the module');
  assertSettledSnapshot(baseline, after);
  return { ...after, refused: message };
}
