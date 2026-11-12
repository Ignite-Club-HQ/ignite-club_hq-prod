// Real club/events/queue Wasms and management snapshots on an OWNED local
// PocketIC instance only. Partial inventory acceptance, never live recovery.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
import { assertCandidEqual } from './assert-candid-equal.mjs';

const report = { kind: 'engine-preparation-real-canister-restore', passed: false,
  preparationOnly: true, releaseAuthorized: false, fullInventoryAcceptance: false,
  encryptedMediaRecoverable: false, modules: {}, checks: [] };
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const owner = p(1), coach = p(2), member = p(3), outsider = p(4);
const ok = value => { assert.ok(value && 'Ok' in value, String(value?.Err)); return value.Ok; };
let pic, server, primaryError;
const started = performance.now();
try {
  assert.ok(process.env.ENGINE_RESTORE_REPORT, 'Local evidence path required');
  report.host = removalHostPreflight();
  // No remote URL, keys or configured service IDs are accepted.
  const inputs = [['club_domain', clubIdl, process.env.CLUB_DOMAIN_WASM],
    ['events_domain', eventsIdl, process.env.EVENTS_DOMAIN_WASM],
    ['notification_queue', queueIdl, process.env.NOTIFICATION_QUEUE_WASM]];
  for (const [name, , wasm] of inputs) {
    assert.ok(wasm, `Built local ${name} Wasm required`);
    report.modules[name] = createHash('sha256').update(readFileSync(wasm)).digest('hex');
  }
  server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 });
  pic = await PocketIc.create(server.url, { processingTimeoutMs: 60000 });
  allowLongUpdates(pic);
  const fixtures = [];
  for (const [, idlFactory, wasm] of inputs) fixtures.push(await pic.setupCanister({ idlFactory, wasm,
    sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal], [owner]) }));
  const [club, events, queue] = fixtures;
  fixtures.forEach(f => f.actor.setPrincipal(owner));
  ok(await club.actor.create_club('restore-club', 'Local restore', 'local-restore', [], []));
  const acl = ok(await club.actor.export_acl());
  ok(await club.actor.replace_acl(acl.acl_version, { ...acl.acl, roles: [
    { user: owner, role: 'club_admin', club: ['restore-club'], team: [] },
    { user: coach, role: 'coach', club: ['restore-club'], team: [] },
    { user: member, role: 'player', club: ['restore-club'], team: [] },
  ] }));
  ok(await events.actor.set_club_domain_canister(club.canisterId));
  ok(await club.actor.set_events_domain_canister(events.canisterId));
  ok(await club.actor.set_notification_queue_canister(queue.canisterId));
  ok(await queue.actor.set_club_domain_canister(club.canisterId));
  const start = BigInt(await pic.getTime()) + 172800000n;
  const input = { request_id: 'restore-once', club_id: 'restore-club', team_id: [], title: 'Local match',
    description: 'Restore fixture', event_type: 'game', location: [], opponent: [], address: [], mini_league_id: [],
    rsvp_audience: ['players_only'], adults_only: true, restricted_to_roles: [], target_team_ids: [],
    occurrences: [{ starts_at_ms: start, ends_at_ms: start + 3600000n }], duties: [], duty_team_id: [], reminder_hours: [] };
  events.actor.setPrincipal(coach);
  const created = ok(await events.actor.create_event_with_setup(input));
  ok(await events.actor.set_schedule_view('calendar'));
  ok(await events.actor.send_individual_event_reminder(created.first_event_id, [member.toText()], []));
  queue.actor.setPrincipal(member);
  const beforeInbox = ok(await queue.actor.list_inbox(member.toText(), ['restore-club'], 20));
  assert.equal(beforeInbox.length, 1);
  club.actor.setPrincipal(owner);
  const beforeAcl = ok(await club.actor.export_acl());
  events.actor.setPrincipal(outsider);
  assert.ok('Err' in await events.actor.create_event_with_setup({ ...input, request_id: 'foreign' }));
  report.checks.push('real setup, roles, receipt, queued reminder and foreign-write denial');

  const management = async (method, inputType, value, outputTypes) => IDL.decode(outputTypes,
    await pic.updateCall({ canisterId: Principal.managementCanister(), sender: owner, method,
      arg: IDL.encode([inputType], [value]) }));
  const takeType = IDL.Record({ canister_id: IDL.Principal, replace_snapshot: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const snapshotType = IDL.Record({ id: IDL.Vec(IDL.Nat8), taken_at_timestamp: IDL.Nat64, total_size: IDL.Nat64 });
  const loadType = IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) });
  const stopAll = async () => { for (const f of [events, queue, club]) await pic.stopCanister({ canisterId: f.canisterId, sender: owner }); };
  await stopAll();
  const snapshots = [];
  for (const f of [events, queue, club]) {
    const [saved] = await management('take_canister_snapshot', takeType, { canister_id: f.canisterId, replace_snapshot: [] }, [snapshotType]);
    snapshots.push({ fixture: f, id: saved.id });
  }
  // Deliberately change real persisted state after the checkpoint.
  for (const f of [club, events, queue]) await pic.startCanister({ canisterId: f.canisterId, sender: owner });
  events.actor.setPrincipal(coach); ok(await events.actor.set_schedule_view('list'));
  const after = ok(await events.actor.create_event_with_setup({ ...input, request_id: 'after-checkpoint' }));
  assert.notEqual(after.first_event_id, created.first_event_id);
  club.actor.setPrincipal(owner);
  const changedAcl = ok(await club.actor.export_acl());
  ok(await club.actor.replace_acl(changedAcl.acl_version, { ...changedAcl.acl, roles: changedAcl.acl.roles.filter(r => r.user.toText() !== member.toText()) }));
  const restoreStarted = performance.now();
  await stopAll();
  for (const saved of snapshots) await management('load_canister_snapshot', loadType,
    { canister_id: saved.fixture.canisterId, snapshot_id: saved.id, sender_canister_version: [] }, []);
  // Local test-only start AFTER all snapshots loaded; not production resume approval.
  for (const f of [club, events, queue]) await pic.startCanister({ canisterId: f.canisterId, sender: owner });
  club.actor.setPrincipal(owner); assertCandidEqual(ok(await club.actor.export_acl()), beforeAcl);
  events.actor.setPrincipal(coach);
  assert.deepEqual(await events.actor.get_schedule_view(), ['calendar']);
  assertCandidEqual(ok(await events.actor.create_event_with_setup(input)), created);
  assert.ok('Err' in await events.actor.create_event_with_setup({ ...input, title: 'conflicting payload' }));
  assert.ok('Err' in await events.actor.send_individual_event_reminder(created.first_event_id, [member.toText()], []));
  queue.actor.setPrincipal(member);
  assertCandidEqual(ok(await queue.actor.list_inbox(member.toText(), ['restore-club'], 20)), beforeInbox);
  events.actor.setPrincipal(outsider);
  assert.ok('Err' in await events.actor.create_event_with_setup({ ...input, request_id: 'still-foreign' }));
  report.restoreElapsedMs = performance.now() - restoreStarted;
  report.checks.push('real management snapshot/load restores full ACL, private preference, payload-bound receipt, reminder cooldown and inbox; outsider still refused');
  report.passed = true;
} catch (error) { primaryError = error; }
finally {
  report.elapsedMs = performance.now() - started;
  await finishRemovalLocalTest({ pic, server, report, primaryError,
    writeReport: async () => {
      if (process.env.ENGINE_RESTORE_REPORT) writeFileSync(process.env.ENGINE_RESTORE_REPORT, JSON.stringify(report, null, 2));
    } });
}