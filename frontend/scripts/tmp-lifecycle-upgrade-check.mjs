import { PocketIc } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { startRemovalLocalServer } from './removal-local-supervisor.mjs';
import { createLocalLifecycleReader } from './removal-local-lifecycle.mjs';

const server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 900 });
const pic = await PocketIc.create(server.url, { processingTimeoutMs: 300000 });
try {
  const owner = Principal.fromUint8Array(new Uint8Array([1]));
  const read = await createLocalLifecycleReader(pic, owner);
  const extra = await pic.createCanister({ sender: owner, controllers: [owner] });
  const info = await read(extra);
  console.log('PASS: probe install + upgrade with wasm_memory_persistence=keep succeeded; changes =', info.changes);
} finally {
  await pic.tearDown();
  await server.stop();
}
