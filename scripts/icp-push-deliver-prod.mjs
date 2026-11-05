import { createRequire } from 'node:module';
import { runProdPush } from './prod-push-config.mjs';

try {
  const req = createRequire(`${process.env.PUSH_WORKER_NODE_PATH}/resolve.js`);
  const { Principal } = req('@icp-sdk/core/principal');
  await runProdPush(process.env, id => Principal.fromText(id), async validated => {
    Object.assign(process.env, validated);
    await import('./icp-push-deliver.mjs');
  });
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}