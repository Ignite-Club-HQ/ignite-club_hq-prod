// Independent external controller fencing on a real isolated network.
//
// Proves the four things the recovery design depends on and nothing else can
// show: an exclusive controller handover through the actual management canister,
// a controller-only readback that confirms it, total exclusion of the former
// operator from every control path, and what fencing does to a signed recovery
// acceptance. Isolated evidence only: it never authorizes release or opening.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc } from '@dfinity/pic';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as witnessFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { idlFactory as identityFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';
import { assertCandidEqual } from './assert-candid-equal.mjs';
import { createLocalLifecycleReader } from './removal-local-lifecycle.mjs';
import { INDEPENDENT_FENCE, assertIndependentFence, handOverControl, readControllerStatus,
  assertExclusiveController, assertRefusedWithoutControl, fenceSnapshot } from './external-controller-fencing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const owner = p(1), human = p(2), stranger = p(3), fence = INDEPENDENT_FENCE;
const ok = r => { assert.ok(r && 'Ok' in r, String(r?.Err)); return r.Ok; };
const refuses = (r, reason) => { assert.ok(r && 'Err' in r, 'Expected explicit refusal'); assert.match(r.Err, reason); };
const bytes = n => new Uint8Array(32).fill(n);
const mark = name => report.checks.push({ name, passed: true });
const report = { schema: 1, kind: 'external-controller-fencing-isolated', passed: false,
  externalControllerFencing: false, releaseAuthorized: false, checks: [], modules: {}, targets: [] };
let server, pic, stage = 'host preflight';

// A controller-only read by a principal that no longer controls the canister is
// the real exclusion signal; an unrelated transport failure must not count.
const refusedControlRead = async (canisterId, sender) => {
  let message;
  try { await readControllerStatus(pic, { canisterId, sender }); }
  catch (error) { message = String(error?.message ?? error).slice(0, 300); }
  if (message === undefined) throw new Error('Non-controller unexpectedly read controller-only status');
  return message;
};

try {
  assert.ok(process.env.EXTERNAL_CONTROLLER_FENCING_REPORT, 'Evidence destination required');
  assert.ok(process.env.REMOVAL_LIFECYCLE_PROBE_WASM, 'Disposable lifecycle reader Wasm required');
  report.host = removalHostPreflight();
  assertIndependentFence(fence, [owner, human, stranger]);
  server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 900 });
  pic = await PocketIc.create(server.url, { processingTimeoutMs: 60000 }); allowLongUpdates(pic);
  const identityId = await pic.createCanister({ sender: owner, controllers: [owner] });
  const witnessId = await pic.createCanister({ sender: owner, controllers: [owner] });
  const participant = await pic.createCanister({ sender: owner, controllers: [owner] });
  const approvalKey = generateKeyPairSync('ed25519'), recoveryKey = generateKeyPairSync('ed25519');
  const publicHex = k => k.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  stage = 'build isolated immutable public pins';
  const target = path.join(root, 'target/isolated-controller-fencing');
  execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
    '-p', 'recovery_witness'], {
    cwd: root, timeout: 360000, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, CARGO_TARGET_DIR: target, IGNITE_PRODUCTION_ACCOUNT_WITNESS: witnessId.toText(),
      IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY: publicHex(approvalKey),
      IGNITE_RECOVERY_APPROVER_PUBLIC_KEY: publicHex(recoveryKey) } });
 // Witness first: identity pins its exact program fingerprint and sole controller.
 const witnessPinHash=(await import('node:crypto')).createHash('sha256').update((await import('node:fs')).readFileSync(path.join(target,'wasm32-unknown-unknown/release/recovery_witness.wasm'))).digest('hex');
 execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
    '-p', 'identity_access'], {
    cwd: root, timeout: 360000, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, CARGO_TARGET_DIR: target, IGNITE_PRODUCTION_ACCOUNT_WITNESS: witnessId.toText(), IGNITE_PRODUCTION_ACCOUNT_WITNESS_MODULE_HASH: witnessPinHash, IGNITE_PRODUCTION_ACCOUNT_WITNESS_CONTROLLER: owner.toText(),
      IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY: publicHex(approvalKey),
      IGNITE_RECOVERY_APPROVER_PUBLIC_KEY: publicHex(recoveryKey) } });
  const wasm = name => path.join(target, 'wasm32-unknown-unknown/release', `${name}.wasm`);
  for (const name of ['identity_access', 'recovery_witness'])
    report.modules[name] = readFileSync(wasm(name)).length;
  const identityArgs = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor: owner }]);
  await pic.installCode({ canisterId: identityId, sender: owner, wasm: wasm('identity_access'), arg: identityArgs });
  await pic.installCode({ canisterId: witnessId, sender: owner, wasm: wasm('recovery_witness'),
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal, identity: IDL.Principal })], [{ governor: owner, identity: identityId }]) });
  await pic.installCode({ canisterId: participant, sender: owner, wasm: wasm('identity_access'), arg: identityArgs });
  const id = pic.createActor(identityFactory, identityId), w = pic.createActor(witnessFactory, witnessId);
  // Actors start anonymous; governor-only witness reads must come from the governor.
  w.setPrincipal(owner);
  id.setPrincipal(human); const account = ok(await id.register_account()); id.setPrincipal(owner);
  const lifecycle = await createLocalLifecycleReader(pic, owner);
  stage = 'arm a genuinely signed independent recovery acceptance';
  const head = ok(await w.read_recovery_head());
  const body = { witness: witnessId, witness_version: ok(await w.read_recovery_runtime_version()), identity: identityId,
    epoch: head.epoch, journal_revision: head.revision, journal_digest: head.digest,
    inventory_digest: bytes(1), decoded_history_digest: bytes(2), generation: 1n, signed_digest: bytes(3),
    expires_at_ns: BigInt(await pic.getTime() + 120000) * 1000000n, history_revision: 0n, removal_generation: 0n,
    identity_version: ok(await id.read_production_account_runtime_version()),
    participants: [await lifecycle(identityId), await lifecycle(participant)] };
  const signBody = async b => ({ body: b, signature: new Uint8Array(sign(null, Buffer.from(ok(await w.recovery_acceptance_signing_bytes(b))), recoveryKey.privateKey)) });
  const signed = await signBody(body);
  const request = { identity: identityId, generation: 1n, recovery_epoch: head.epoch, signed_digest: bytes(3),
    request_id: 1n, history_revision: 0n, removal_generation: 0n, identity_version: body.identity_version };
  w.setPrincipal(identityId); refuses(await w.verify_production_account_read_fence(request), /Recovery remains fenced/);
  w.setPrincipal(owner);
  assert.equal(ok(await w.accept_recovery_fence(signed)), head.epoch);
  w.setPrincipal(identityId);
  assertCandidEqual(ok(await w.verify_production_account_read_fence(request)).request, request);
  w.setPrincipal(owner);
  mark('Independent recovery acceptance is signed, armed and verified before any controller change');
  stage = 'measure lifecycle and journal state before fencing';
  const targets = [{ name: 'identity', canisterId: identityId }, { name: 'witness', canisterId: witnessId },
    { name: 'participant', canisterId: participant }];
  const before = new Map();
  for (const t of targets) {
    const status = await readControllerStatus(pic, { canisterId: t.canisterId, sender: owner });
    assertExclusiveController(status, owner);
    const info = await lifecycle(t.canisterId);
    before.set(t.name, { ...fenceSnapshot(status), changes: info.changes, lifecycleModule: info.module });
  }
  const journalBefore = ok(await w.read_recovery_head());
  stage = 'hand exclusive control to one independent external fence';
  for (const t of targets) {
    const fenced = await handOverControl(pic, { canisterId: t.canisterId, from: owner, to: fence });
    report.targets.push({ name: t.name, canister: t.canisterId.toText(), controllerBefore: owner.toText(),
      controllerAfter: fenced.controllers[0], moduleHashBefore: before.get(t.name).moduleHash,
      moduleHashAfter: fenced.moduleHash, memorySizeBefore: before.get(t.name).memorySize,
      memorySizeAfter: fenced.memorySize });
  }
  mark('Every target reads back exactly one independent controller with an unchanged module');
  stage = 'verify fencing is a detectable lifecycle change, not an invisible one';
  for (const t of targets) {
    const after = await lifecycle(t.canisterId);
    assert.ok(after.changes > before.get(t.name).changes,
      `Controller handover on ${t.name} must advance the management change count`);
    assert.ok(before.get(t.name).lifecycleModule, `Lifecycle reader must report a module for ${t.name}`);
    assert.equal(Buffer.from(after.module).toString('hex'), Buffer.from(before.get(t.name).lifecycleModule).toString('hex'),
      'Fencing must not replace the module');
    assert.equal(Buffer.from(after.module).toString('hex'), before.get(t.name).moduleHash,
      'Lifecycle reader and controller status must agree on the module');
  }
  mark('Independent lifecycle reader still authenticates every fenced target and sees the handover');
  stage = 'verify the accepted recovery journal survives a controller change';
  assertCandidEqual(ok(await w.read_recovery_head()), journalBefore);
  mark('Fencing the witness preserves its recovery journal unchanged');
  stage = 'exclude the former operator from every control path';
  for (const t of targets) {
    const baseline = before.get(t.name);
    const reclaims = await assertRefusedWithoutControl(pic, { canisterId: t.canisterId, fence, moduleHash: baseline.moduleHash,
      attempt: () => pic.updateCanisterSettings({ canisterId: t.canisterId, sender: owner, controllers: [owner] }) });
    const reinstalls = await assertRefusedWithoutControl(pic, { canisterId: t.canisterId, fence, moduleHash: baseline.moduleHash,
      attempt: () => pic.reinstallCode({ canisterId: t.canisterId, sender: owner, wasm: wasm(t.name === 'witness' ? 'recovery_witness' : 'identity_access'), arg: t.name === 'witness' ? IDL.encode([IDL.Record({ governor: IDL.Principal, identity: IDL.Principal })], [{ governor: owner, identity: identityId }]) : identityArgs }) });
    const upgrades = await assertRefusedWithoutControl(pic, { canisterId: t.canisterId, fence, moduleHash: baseline.moduleHash,
      attempt: () => pic.upgradeCanister({ canisterId: t.canisterId, sender: owner, wasm: wasm(t.name === 'witness' ? 'recovery_witness' : 'identity_access'), arg: t.name === 'witness' ? IDL.encode([IDL.Record({ governor: IDL.Principal, identity: IDL.Principal })], [{ governor: owner, identity: identityId }]) : identityArgs }) });
    const reads = await refusedControlRead(t.canisterId, owner);
    report.targets.find(x => x.name === t.name).formerOperatorRefusals =
      { settings: reclaims.refused, reinstall: reinstalls.refused, upgrade: upgrades.refused, status: reads };
  }
  mark('Former operator is refused control reads, re-adding itself, reinstalling and upgrading every target');
  stage = 'exclude an unrelated principal and a fenced-out authority';
  for (const t of targets) {
    const strangerRead = await refusedControlRead(t.canisterId, stranger);
    const strangerWrite = await assertRefusedWithoutControl(pic, { canisterId: t.canisterId, fence,
      moduleHash: before.get(t.name).moduleHash,
      attempt: () => pic.updateCanisterSettings({ canisterId: t.canisterId, sender: stranger, controllers: [stranger] }) });
    report.targets.find(x => x.name === t.name).strangerRefusals = { status: strangerRead, settings: strangerWrite.refused };
  }
  mark('An unrelated principal cannot read or change control of any fenced target');
  stage = 'fencing cannot silently preserve a signed review';
  w.setPrincipal(identityId);
  refuses(await w.verify_production_account_read_fence(request), /Witness restored or upgraded; independent reacceptance required/);
  w.setPrincipal(owner);
  mark('Fencing the witness itself invalidates the earlier signed acceptance until a fresh one is armed');
  stage = 'fenced targets keep serving their own accounts';
  id.setPrincipal(human); assert.equal(ok(await id.whoami()).id, account.id); id.setPrincipal(owner);
  mark('Fencing changes who controls code, not what the canister still refuses or serves');
  stage = 're-arm recovery authority under the fenced lifecycle counts';
  const freshHead = ok(await w.read_recovery_head());
  const freshBody = { ...body, epoch: freshHead.epoch, journal_revision: freshHead.revision,
    journal_digest: freshHead.digest, witness_version: ok(await w.read_recovery_runtime_version()),
    identity_version: ok(await id.read_production_account_runtime_version()),
    participants: [await lifecycle(identityId), await lifecycle(participant)],
    expires_at_ns: BigInt(await pic.getTime() + 120000) * 1000000n };
  ok(await w.accept_recovery_fence(await signBody(freshBody)));
  const armedHead = ok(await w.read_recovery_head());
  const freshRequest = { ...request, recovery_epoch: armedHead.epoch, identity_version: freshBody.identity_version };
  w.setPrincipal(identityId);
  assertCandidEqual(ok(await w.verify_production_account_read_fence(freshRequest)).request, freshRequest);
  w.setPrincipal(owner);
  mark('A fresh signed acceptance restores recovery reads under fenced lifecycle counts; fencing is reversible');
  stage = 'a participant-only controller change invalidates the fresh acceptance';
  {
    const restored = await handOverControl(pic, { canisterId: participant, from: fence, to: owner });
    assert.equal(restored.controllers[0], owner.toText());
    assert.equal(restored.moduleHash, before.get('participant').moduleHash, 'Restore must not replace the module');
    w.setPrincipal(identityId);
    refuses(await w.verify_production_account_read_fence(freshRequest), /Recovery participant lifecycle changed/);
    w.setPrincipal(owner);
  }
  mark('Changing control of a participant alone, with the witness untouched, invalidates the signed acceptance');
  stage = 'only the independent fence can hand control back';
  for (const t of targets.filter(x => x.name !== 'participant')) {
    const restored = await handOverControl(pic, { canisterId: t.canisterId, from: fence, to: owner });
    assert.equal(restored.controllers[0], owner.toText());
    assert.equal(restored.moduleHash, before.get(t.name).moduleHash, 'Restore must not replace the module');
  }
  const journalAfter = ok(await w.read_recovery_head());
  assertCandidEqual(journalAfter, armedHead);
  mark('Exclusive control returns only through the fence, leaving the accepted journal intact');
  report.externalControllerFencing = true;
  report.passed = true;
} catch (error) {
  report.failure = error?.name ?? 'Error';
  report.failureDetail = String(error?.message ?? error).slice(0, 600);
  throw error;
} finally {
  report.stage = stage;
  try { if (pic) await Promise.race([pic.tearDown(), new Promise((_, reject) => setTimeout(() => reject(new Error('Bounded teardown')), 5000))]); }
  finally { try { if (server) await server.stop(); } finally {
    if (process.env.EXTERNAL_CONTROLLER_FENCING_REPORT) {
      mkdirSync(path.dirname(process.env.EXTERNAL_CONTROLLER_FENCING_REPORT), { recursive: true });
      writeFileSync(process.env.EXTERNAL_CONTROLLER_FENCING_REPORT, JSON.stringify(report, null, 2) + '\n');
    } } }
}
