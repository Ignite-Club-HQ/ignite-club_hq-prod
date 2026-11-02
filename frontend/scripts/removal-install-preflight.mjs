import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';

export async function removalInstallPreflight({ binary, wasm, reportPath } = {}) {
  assert.ok(binary && wasm && reportPath, 'Pinned binary, real probe Wasm and report path required');
  const hash = value => createHash('sha256').update(readFileSync(value)).digest('hex');
  const report = { schema: 1, kind: 'local-installation-only', passed: false,
    releaseAuthorized: false, receiverAcceptance: false, binarySha256: hash(binary),
    wasmSha256: hash(wasm), stage: 'start isolated local server' };
  let server;
  const started = Date.now();
  try {
    server = await startRemovalLocalServer({ binary, hardTtlSeconds: 45 });
    report.binaryVersion = server.version;
    report.stage = 'create disposable local instance';
    const pic = await PocketIc.create(server.url, { processingTimeoutMs: 30000 });
    report.stage = 'install minimal actor';
    const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
    const fixture = await pic.setupCanister({
      idlFactory: ({ IDL: I }) => I.Service({ ping: I.Func([], [I.Nat], ['query']) }),
      wasm, sender: governor, controllers: [governor], arg: IDL.encode([], []),
    });
    report.stage = 'query installed actor';
    assert.equal(await fixture.actor.ping(), 1n);
    report.stage = 'passed'; report.passed = true;
    return report;
  } catch (error) {
    report.failure = error?.name ?? 'Error';
    throw new Error(`Local installation preflight failed at ${report.stage}; no receiver or release acceptance established`, { cause: error });
  } finally {
    try { if (server) await server.stop(); }
    finally {
      report.elapsedMs = Date.now() - started;
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await removalInstallPreflight({ binary: process.env.POCKET_IC_BIN,
    wasm: process.env.REMOVAL_INSTALL_PROBE_WASM, reportPath: process.env.REMOVAL_INSTALL_REPORT });
}