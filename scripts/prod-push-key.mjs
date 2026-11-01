// CI-only minting. Only authenticated ciphertext and the public principal persist.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubJournal } from './prod-base-group.mjs';
import { assertPushKeyContext, assertNoStoredPushKey, sealPushSeed, openPushSeed } from './prod-push-key-policy.mjs';

export async function mintOrReadPushKey(env, journal, identityType) {
  assertPushKeyContext(env);
  const receipt = await journal.load({ readOnly: true });
  if (receipt) {
    if (receipt.phase !== 'encrypted-ready' || receipt.repository !== env.GITHUB_REPOSITORY) throw new Error('Existing key intent is unresolved; inspect it, never regenerate');
    const seed = openPushSeed(receipt.encryptedSeed, env.PASSPHRASE);
    if (identityType.fromSecretKey(new Uint8Array(Buffer.from(seed, 'hex'))).getPrincipal().toText() !== receipt.principal) throw new Error('Saved delivery key does not match its receipt');
    return receipt;
  }
  assertNoStoredPushKey(env);
  // Create the branch before the intent. Once this intent is durable, an
  // interrupted run can never generate a second identity automatically.
  await journal.load();
  await journal.save({ phase: 'mint-pending', repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID });
  const identity = identityType.generate();
  const seed = Buffer.from(identity.getKeyPair().secretKey).subarray(0, 32).toString('hex');
  const principal = identity.getPrincipal().toText();
  if (identityType.fromSecretKey(new Uint8Array(Buffer.from(seed, 'hex'))).getPrincipal().toText() !== principal) throw new Error('Generated identity verification failed');
  if (['2vxsx-fae', 'aaaaa-aa', env.PROD_GOVERNOR_PRINCIPAL, env.DEV_PUSH_WORKER_PRINCIPAL].includes(principal)) throw new Error('Generated delivery identity is not independent');
  const ready = { phase: 'encrypted-ready', repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
    principal, encryptedSeed: sealPushSeed(seed, env.PASSPHRASE), deliveryEnabled: false };
  await journal.save(ready);
  return ready;
}

async function main() {
  const env = process.env;
  const require = createRequire(`${env.PUSH_WORKER_NODE_PATH}/resolve.js`);
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const receipt = await mintOrReadPushKey(env, githubJournal(env, fetch, {
    branch: 'prod-group-setup', path: 'prod-group-setup/push-key.json', label: 'encrypted delivery key',
  }), Ed25519KeyIdentity);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `## PROD notification key ready\n\nSet repository variable \`PROD_ICP_PUSH_WORKER_PRINCIPAL\`:\n\n${receipt.principal}\n\nSave this whole encrypted block as repository secret \`PROD_ICP_PUSH_WORKER_SEED_ENC\`:\n\n\`\`\`text\n${receipt.encryptedSeed}\n\`\`\`\n\nKeep \`PROD_ICP_PUSH_WORKER_PASSPHRASE\` in GitHub and Bitwarden. Do not decrypt it in your browser.\n\nNo canisters, funding, Supabase settings or Firebase credentials changed. ICP delivery remains disabled.\n\nNext: run **[PROD] Create second group (closed)** on **prod**, action **plan**, hash and confirmation blank.\n`);
  console.log('Encrypted delivery key and public principal are in the Summary. ICP delivery remains disabled.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('PROD key setup stopped. Check branch, confirmation, dedicated passphrase and stored key receipt; no automatic replacement is allowed.');
  process.exitCode = 1;
});