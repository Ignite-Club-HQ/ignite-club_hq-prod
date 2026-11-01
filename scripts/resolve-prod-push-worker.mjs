// Publish only the public address. Plain seed never enters GitHub environment/output.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { resolveProdPushPrincipal } from './prod-push-key-policy.mjs';
try {
  const require = createRequire(`${process.env.PUSH_WORKER_NODE_PATH}/resolve.js`);
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const principal = resolveProdPushPrincipal(process.env, Ed25519KeyIdentity);
  appendFileSync(process.env.GITHUB_ENV, `PUSH_WORKER_PRINCIPAL=${principal}\n`);
} catch {
  console.error('PROD notification key could not be verified. Check its encrypted secret, passphrase and principal; never replace an existing key to bypass this check.');
  process.exitCode = 1;
}