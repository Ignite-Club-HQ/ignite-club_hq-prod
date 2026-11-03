import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requirePocketIc14, stopOwnedProcess, startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';

test('owned server receives the same explicit idle and hard test budget', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'removal-ttl-test-'));
  const binary = path.join(directory, 'fake-pocket-ic');
  writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('PocketIC 14.0.0'); process.exit(0); }
const flag=name=>args[args.indexOf(name)+1];
if(!args.includes('--ttl') || flag('--ttl')!=='30' || flag('--hard-ttl')!=='30') process.exit(2);
fs.writeFileSync(flag('--port-file'),'12345'); setInterval(()=>{},1000);
`, { mode: 0o700 });
  let server;
  try {
    server = await startRemovalLocalServer({ binary, hardTtlSeconds: 30 });
    assert.equal(server.url, 'http://127.0.0.1:12345');
  } finally { if (server) await server.stop(); rmSync(directory, { recursive: true, force: true }); }
});

test('server cleanup cannot replace the original test error and evidence', async () => {
  const primaryError = new TypeError('original install fetch failed');
  const report = { passed: false, stage: 'install isolated identity and witness' };
  let saved;
  await assert.rejects(finishRemovalLocalTest({
    primaryError, report,
    pic: { tearDown: async () => { throw Error('cleanup connection refused'); } },
    server: { stop: async () => { throw Error('stop failed'); } },
    writeReport: () => { saved = structuredClone(report); },
  }), error => error === primaryError);
  assert.equal(saved.failureDetail, 'original install fetch failed');
  assert.match(saved.failureStack, /original install fetch failed/);
  assert.equal(saved.stage, 'install isolated identity and witness');
  assert.deepEqual(saved.cleanupErrors.map(e => e.message), ['cleanup connection refused', 'stop failed']);
});

test('cleanup failure fails a successful body, saves evidence and still stops the server', async () => {
  const report = { passed: true }; let stopped = false, saved = false;
  await assert.rejects(finishRemovalLocalTest({ report,
    pic: { tearDown: async () => { throw Error('cleanup failed'); } },
    server: { stop: async () => { stopped = true; } },
    writeReport: () => { saved = true; assert.equal(report.passed, false); },
  }), /cleanup failed/);
  assert.equal(stopped, true); assert.equal(saved, true);
});

test('bounded teardown preserves primary failure and normal cleanup passes', async () => {
  const primaryError = Error('original failure'); const report = { passed: false };
  await assert.rejects(finishRemovalLocalTest({ report, primaryError, timeoutMs: 10,
    pic: { tearDown: () => new Promise(() => {}) }, writeReport: () => {},
  }), error => error === primaryError);
  assert.equal(report.cleanupErrors[0].message, 'Bounded teardown');
  const success = { passed: true };
  await finishRemovalLocalTest({ report: success, pic: { tearDown: async () => {} },
    server: { stop: async () => {} }, writeReport: () => {},
  });
  assert.equal(success.passed, true);
});

test('local acceptance refuses absent or relative binaries before spawning', () => {
  for (const binary of [undefined, '', 'pocket-ic', 'https://icp-api.io'])
    assert.throws(() => requirePocketIc14(binary), /Absolute pinned/);
});
test('local acceptance refuses unbounded server lifetimes', async () => {
  for (const hardTtlSeconds of [0, 9, 1801, Infinity, 1.5])
    await assert.rejects(startRemovalLocalServer({ binary: '/unused', hardTtlSeconds }), /Bounded local/);
});
test('cleanup terminates a hung owned process without terminating another process', async () => {
  const create = () => spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'],
    { detached: true, stdio: 'ignore' });
  const owned = create(), unrelated = create();
  await Promise.all([new Promise(resolve => owned.once('spawn', resolve)), new Promise(resolve => unrelated.once('spawn', resolve))]);
  try {
    const exited = new Promise(resolve => owned.once('exit', resolve));
    await stopOwnedProcess(owned, { graceMs: 100 });
    await exited;
    assert.ok(owned.signalCode !== null || owned.exitCode !== null);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally { await stopOwnedProcess(unrelated, { graceMs: 100 }); }
});