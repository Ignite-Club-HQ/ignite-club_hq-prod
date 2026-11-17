import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { removalHostPreflight } from '../frontend/scripts/removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from '../frontend/scripts/removal-local-supervisor.mjs';
const require = createRequire(resolve('frontend/package.json'));
const { PocketIc } = require('@dfinity/pic');
const { IDL } = require('@icp-sdk/core/candid');
test('proxy Candid encoding and original encryption routes on a disposable canister', async t => {
  try { removalHostPreflight(); }
  catch (error) { t.skip(`Runtime acceptance unavailable: ${error.message}`); return; }
  const dir = mkdtempSync(join(tmpdir(), 'engine-vetkd-test-'));
  let server, pic, primaryError;
  try {
    const sources = spawnSync('mops', ['sources'], { cwd: 'backend/pii_access_control', encoding: 'utf8' });
    assert.equal(sources.status, 0);
    const wasm = join(dir, 'test.wasm');
    const compile = spawnSync('/root/.cache/mops/moc/1.16.1/moc', [...sources.stdout.trim().split(/\s+/), '-o', wasm, 'test/engineVetKd.test.mo'], { cwd: 'backend/pii_access_control', encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    server = await startRemovalLocalServer({ binary: resolve('frontend/node_modules/@dfinity/pic/pocket-ic'), hardTtlSeconds: 120 });
    pic = await PocketIc.create(server.url);
    const { actor } = await pic.setupCanister({ wasm, idlFactory: () => IDL.Service({
      run: IDL.Func([], [IDL.Bool], ['query']),
      refuseRouteChange: IDL.Func([], [IDL.Bool], ['query']),
      refuseMainnetRepoint: IDL.Func([], [IDL.Bool], ['query']),
    }) });
    assert.equal(await actor.run(), true);
    await assert.rejects(actor.refuseRouteChange());
    await assert.rejects(actor.refuseMainnetRepoint());
  } catch (error) { primaryError = error; }
  finally {
    try { await finishRemovalLocalTest({ pic, server, primaryError, report: {}, writeReport: async () => {} }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
});