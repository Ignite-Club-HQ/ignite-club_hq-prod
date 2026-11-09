// No supplied hosts, canister mappings, deployed identities or network adapters.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PocketIc, CanisterCyclesCostSchedule } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';
import { timerCounts, classifyRetry, IDLE_MINUTES, LOW_FUEL_ROUNDS, LOW_FUEL_STEP_MS, HEADROOMS } from './club-fuel-policy.mjs';

const report = { scope: 'disposable-local-only', deployedServicesChanged: false,
  productionCauseProven: false, compiler: '1.16.1', passed: false, idle: [], lowFuel: [] };
const output = process.env.CLUB_FUEL_REPORT;
if (!output) throw Error('CLUB_FUEL_REPORT required');
const save = () => writeFileSync(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const probeIdl = ({ IDL }) => IDL.Service({
  armAndDrain: IDL.Func([IDL.Bool, IDL.Nat], [IDL.Nat], []),
  counts: IDL.Func([], [IDL.Record({ directory: IDL.Nat, cleanup: IDL.Nat })], ['query']),
});
let server, pic, primaryError;
try {
  report.host = removalHostPreflight();
  const probeWasm = readFileSync(process.env.CLUB_FUEL_PROBE_WASM);
  const clubWasm = readFileSync(process.env.CLUB_DOMAIN_WASM);
  report.wasm = { probe: createHash('sha256').update(probeWasm).digest('hex'), club: createHash('sha256').update(clubWasm).digest('hex') };
  server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 });
  report.replica = server.version;
  pic = await PocketIc.create(server.url, { application: [{ costSchedule: CanisterCyclesCostSchedule.Normal }] });
  const createProbe = () => pic.setupCanister({ idlFactory: probeIdl, wasm: probeWasm, sender: governor,
    controllers: [governor], cycles: 5_000_000_000_000n, freezingThreshold: 0n });
  const control = await createProbe(), timers = await createProbe();
  for (const [f, enabled] of [[control, false], [timers, true]]) {
    f.actor.setPrincipal(governor);
    await f.actor.armAndDrain(enabled, 4_000_000_000_000n);
  }
  const clubId = await pic.createCanister({ sender: governor, controllers: [governor], cycles: 5_000_000_000_000n, freezingThreshold: 0n });
  await pic.installCode({ canisterId: clubId, wasm: clubWasm, sender: governor, arg: IDL.encode([IDL.Principal], [governor]) });
  await pic.tick(10);
  const targets = [{ name: 'control', id: control.canisterId }, { name: 'matching-idle-timers', id: timers.canisterId }, { name: 'actual-empty-club', id: clubId }];
  const before = await Promise.all(targets.map(t => pic.getCyclesBalance(t.id)));
  for (let minute = 0; minute < IDLE_MINUTES; minute++) { await pic.advanceTime(60_000); await pic.tick(10); }
  const after = await Promise.all(targets.map(t => pic.getCyclesBalance(t.id)));
  report.idle = targets.map((t, i) => ({ name: t.name, before: before[i], after: after[i], consumed: before[i] - after[i], simulatedSeconds: IDLE_MINUTES * 60 }));
  report.idleCounts = await timers.actor.counts();
  assert.deepEqual(report.idleCounts, timerCounts(IDLE_MINUTES * 60));
  assert.ok(report.idle[1].consumed > report.idle[0].consumed, 'timers must consume more than the no-timer control');
  save();
  // Sweep balances on fresh disposable actors only. Burn is test setup, never
  // included in measured consumption; counters and observations distinguish
  // frozen/no-progress outcomes from proven high-frequency timer execution.
  for (const keep of HEADROOMS) {
    const samples = [];
    for (const mode of ['control', 'timers']) {
      const sample = { mode, keep };
      const f = await createProbe(); f.actor.setPrincipal(governor);
      try {
        await f.actor.armAndDrain(mode === 'timers', keep);
        await pic.advanceTime(30_000); await pic.tick(1);
        sample.before = await pic.getCyclesBalance(f.canisterId);
        for (let round = 0; round < LOW_FUEL_ROUNDS; round++) { await pic.advanceTime(LOW_FUEL_STEP_MS); await pic.tick(); }
        sample.after = await pic.getCyclesBalance(f.canisterId);
        sample.counts = await f.actor.counts();
      } catch (error) { sample.error = error.message.slice(0, 1000); }
      samples.push(sample);
      await pic.stopCanister({ canisterId: f.canisterId, sender: governor });
    }
    report.lowFuel.push({ keep, simulatedSeconds: 8, rounds: LOW_FUEL_ROUNDS, samples, verdict: classifyRetry(samples) });
    save();
  }
  report.passed = true;
  console.log(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
} catch (error) { primaryError = error; }
finally { await finishRemovalLocalTest({ pic, server, report, primaryError, writeReport: save }); }