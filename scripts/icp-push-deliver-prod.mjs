import { createRequire } from 'node:module';
import { runProdPush, resolveProdWorkerSeed } from './prod-push-config.mjs';

try {
  const req = createRequire(`${process.env.PUSH_WORKER_NODE_PATH}/resolve.js`);
  const { Principal } = req('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = req('@icp-sdk/core/identity');
  // Decrypt the stored key in memory and confirm it is the recorded PROD worker.
  const seed = resolveProdWorkerSeed(process.env, Ed25519KeyIdentity);
  const env = { ...process.env, PROD_ICP_PUSH_WORKER_SEED: seed, PROD_ICP_PUSH_WORKER_SEED_ENC: '' };
  await runProdPush(env, id => Principal.fromText(id), async validated => {
    Object.assign(process.env, validated);
    await import('./icp-push-deliver.mjs');
  });
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
