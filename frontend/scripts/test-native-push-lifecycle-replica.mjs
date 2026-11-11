// Disposable replica only. The TEST address is allocated inside PocketIC;
// no live agent, network host, stored identity or Firebase transport is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PocketIc } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';

const output = process.env.NATIVE_PUSH_REPLICA_REPORT;
assert.ok(output, 'Native replica evidence path required');
const report = { scope: 'disposable-native-queue-only', passed: false, releaseAuthorized: false,
  alertSent: false, checks: [], remaining: ['installation lineage', 'receipt erasure', 'private endpoint', 'native TEST phone acceptance'] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), member = p(2), worker = p(3), stranger = p(4), successor = p(5);
const ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const empty = r => assert.equal(ok(r).length, 0);
let server, pic, primaryError;
try {
  // Refuse this sandbox's incompatible memory tracker before any installation.
  report.host = removalHostPreflight();
  assert.ok(process.env.NOTIFICATION_QUEUE_WASM, 'Exact queue Wasm required; no skipped proof');
  const wasm = readFileSync(process.env.NOTIFICATION_QUEUE_WASM);
  report.wasmSha256 = createHash('sha256').update(wasm).digest('hex');
  server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 });
  report.replica = server.version;
  pic = await PocketIc.create(server.url, { processingTimeoutMs: 60000 });
  const setup = extra => pic.setupCanister({ idlFactory, wasm, sender: governor,
    controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]), ...extra });
  const local = await setup({ targetCanisterId: Principal.fromText('jfcdq-yiaaa-aaaal-qxloa-cai') });
  assert.equal(local.canisterId.toText(), 'jfcdq-yiaaa-aaaal-qxloa-cai', 'TEST address must exist only in this disposable replica');
  const q = local.actor;
  q.setPrincipal(governor);
  assert.equal((await q.native_push_configuration()).enabled, false);
  q.setPrincipal(stranger);
  await assert.rejects(() => q.configure_native_push_worker(worker));
  const other = await setup({});
  other.actor.setPrincipal(governor);
  assert.ok('Err' in await other.actor.configure_native_push_worker(worker));
  report.checks.push('default disabled; governor-only; exact TEST base restriction');

  q.setPrincipal(member);
  ok(await q.register_device_token('android', 'synthetic-native-device', [], []));
  q.setPrincipal(governor);
  ok(await q.grant_worker(worker));
  ok(await q.enqueue('lost-reserve', member.toText(), 'global', 'club_news', 'private fixture', 'lost-key'));
  ok(await q.configure_native_push_worker(worker));
  ok(await q.configure_native_push_worker(worker));
  assert.ok('Err' in await q.configure_native_push_worker(stranger));
  q.setPrincipal(worker);
  assert.ok('Err' in await q.claim(0n, 10));
  assert.ok('Err' in await q.recover());
  q.setPrincipal(stranger);
  assert.ok('Err' in await q.reserve_native_push());
  assert.ok('Err' in await q.authorize_native_push('lost-reserve', 'lost-key', worker));
  report.checks.push('exclusive handover; legacy claim/recover and forged authority refused');

  q.setPrincipal(worker);
  const reservations = await Promise.all([q.reserve_native_push(), q.reserve_native_push()]);
  const rows = reservations.flatMap(ok);
  assert.equal(rows.length, 1, 'Independent workers must not reserve the same source twice');
  const lost = rows[0];
  assert.equal(lost.user, member.toText());
  assert.equal(lost.token, 'synthetic-native-device');
  empty(await q.reserve_native_push());
  q.setPrincipal(member);
  assert.ok('Err' in await q.delete_notification('lost-reserve'));
  assert.ok('Err' in await q.clear_inbox(member.toText(), []));
  q.setPrincipal(governor);
  ok(await q.set_transfer_fence('global', true));
  assert.ok('Err' in await q.export_club_snapshot('global'));
  assert.ok('Err' in await q.purge_club_snapshot('global'));
  ok(await q.set_transfer_fence('global', false));
  await pic.upgradeCanister({ canisterId: local.canisterId, wasm, sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]),
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  q.setPrincipal(worker);
  assert.equal((await q.native_push_configuration()).worker[0].toText(), worker.toText());
  empty(await q.reserve_native_push());
  q.setPrincipal(stranger);
  assert.ok('Err' in await q.settle_native_push(lost.receipt, 'accepted'));
  q.setPrincipal(worker);
  ok(await q.settle_native_push(lost.receipt, 'accepted'));
  ok(await q.settle_native_push(lost.receipt, 'accepted'));
  assert.ok('Err' in await q.settle_native_push(lost.receipt, 'held'));
  empty(await q.reserve_native_push());
  report.checks.push('single concurrent reservation; lost reply held through upgrade; deletion/snapshot drain; original-owner settlement');

  // A resumed registration changes its timestamp, not accepted-send occupancy.
  q.setPrincipal(member);
  await pic.advanceTime(1000);
  ok(await q.register_device_token('android', 'synthetic-native-device', [], []));
  q.setPrincipal(governor);
  ok(await q.set_transfer_fence('global', true));
  const snapshot = ok(await q.export_club_snapshot('global'));
  ok(await q.import_club_snapshot('global', snapshot));
  ok(await q.set_transfer_fence('global', false));
  q.setPrincipal(worker);
  empty(await q.reserve_native_push());
  report.checks.push('accepted occupancy survives resume and same-queue club snapshot replacement');

  q.setPrincipal(governor);
  ok(await q.enqueue('held-send', member.toText(), 'global', 'club_news', 'private fixture', 'held-key'));
  q.setPrincipal(worker);
  const held = ok(await q.reserve_native_push())[0];
  assert.ok(held);
  assert.ok(BigInt(held.receipt) > BigInt(lost.receipt), 'Sequence must survive upgrade');
  ok(await q.settle_native_push(held.receipt, 'held'));
  empty(await q.reserve_native_push());
  q.setPrincipal(governor);
  const moved = await q.rekey_principal(member, successor, false);
  assert.ok('ok' in moved);
  q.setPrincipal(worker);
  empty(await q.reserve_native_push());
  q.setPrincipal(successor);
  const inbox = ok(await q.list_inbox(successor.toText(), [], 10));
  assert.equal(inbox.find(n => n.id === 'held-send')?.status.Failed, null);
  report.checks.push('uncertain sends remain terminal; settled rekey preserves hold; receipt sequence retained');

  // All-member rollout rehearses the exact LIVE address only in PocketIC.
  const live = await setup({ targetCanisterId: Principal.fromText('w263o-3aaaa-aaaai-ayesq-cai') });
  const l = live.actor;
  l.setPrincipal(governor);
  ok(await l.grant_worker(worker));
  ok(await l.configure_native_push_worker(worker));
  l.setPrincipal(member);
  ok(await l.register_device_token('android', 'member-current-phone', [], []));
  assert.ok('Err' in await l.queue_my_native_test_alert(), 'Unapproved ordinary member remains blocked');
  l.setPrincipal(governor);
  ok(await l.enqueue('before-opening', member.toText(), 'app', 'club_news', 'Old update', 'before-opening'));
  await pic.advanceTime(1000);
  l.setPrincipal(stranger);
  await assert.rejects(() => l.configure_native_push_rollout(true, worker));
  l.setPrincipal(governor);
  assert.ok('Err' in await l.configure_native_push_rollout(true, stranger));
  const boundary = ok(await l.configure_native_push_rollout(true, worker));
  assert.ok(boundary > 0n);
  assert.equal(ok(await l.configure_native_push_rollout(true, worker)), boundary);
  l.setPrincipal(worker);
  empty(await l.reserve_native_push());
  l.setPrincipal(member);
  const id = ok(await l.queue_my_native_test_alert());
  l.setPrincipal(worker);
  const current = ok(await l.reserve_native_push())[0];
  assert.equal(current.notification_id, id);
  assert.equal(current.user, member.toText());
  ok(await l.settle_native_push(current.receipt, 'accepted'));
  empty(await l.reserve_native_push());
  await pic.upgradeCanister({ canisterId: live.canisterId, wasm, sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]),
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.equal((await l.native_push_rollout())[0].started_at_ms, boundary);
  l.setPrincipal(governor);
  ok(await l.configure_native_push_rollout(false, worker));
  l.setPrincipal(member);
  assert.ok('Err' in await l.queue_my_native_test_alert());
  report.checks.push('LIVE-address ordinary member pilot refusal; governor/worker activation; no old-alert flood; activation survives upgrade; disabling re-closes ordinary users');
  report.passed = true;
} catch (error) { primaryError = error; }
finally { await finishRemovalLocalTest({ pic, server, report, primaryError, writeReport: save }); }