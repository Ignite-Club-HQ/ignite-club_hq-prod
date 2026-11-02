import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { requirePocketIc14, stopOwnedProcess, startRemovalLocalServer } from './removal-local-supervisor.mjs';

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