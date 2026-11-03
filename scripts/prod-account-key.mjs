import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubJournal } from './prod-base-group.mjs';
import { accountPublicKey, assertAccountKeyContext, assertIndependentKey, assertIndependentProtection, sealAccountSeed, openAccountSeed } from './prod-account-key-policy.mjs';

export async function mintOrReadAccountKey(env, journal, identityType) {
  assertAccountKeyContext(env);
  const describe = seed => {
    const principal = identityType.fromSecretKey(new Uint8Array(Buffer.from(seed, 'hex'))).getPrincipal().toText();
    const publicKey = accountPublicKey(seed);
    assertIndependentKey(publicKey, principal, env);
    return { principal, publicKey };
  };
  const stored = await journal.load({ readOnly: true });
  if (stored) {
    if (stored.version !== 1 || stored.role !== env.KEY_ROLE || stored.repository !== env.GITHUB_REPOSITORY || stored.phase !== 'encrypted-ready')
      throw Error('Existing approval key intent requires manual reconciliation');
    const actual = describe(openAccountSeed(stored.encryptedSeed, env.PASSPHRASE));
    if (actual.principal !== stored.principal || actual.publicKey !== stored.publicKey ||
        (env.EXISTING_PUBLIC_KEY && env.EXISTING_PUBLIC_KEY !== actual.publicKey) ||
        (env.EXISTING_PRINCIPAL && env.EXISTING_PRINCIPAL !== actual.principal) ||
        (env.EXISTING_ENC && env.EXISTING_ENC !== stored.encryptedSeed)) throw Error('Stored approval key binding mismatch');
    return stored;
  }
  if (env.EXISTING_SEED || env.EXISTING_ENC || env.EXISTING_PUBLIC_KEY || env.EXISTING_PRINCIPAL) throw Error('Approval key replacement refused');
  await journal.load();
  await journal.save({ version: 1, role: env.KEY_ROLE, phase: 'mint-pending', repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID });
  const identity = identityType.generate();
  const seed = Buffer.from(identity.getKeyPair().secretKey).subarray(0, 32).toString('hex');
  const actual = describe(seed);
  if (actual.principal !== identity.getPrincipal().toText()) throw Error('Generated key binding mismatch');
  const receipt = { version: 1, role: env.KEY_ROLE, phase: 'encrypted-ready', repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID, ...actual, encryptedSeed: sealAccountSeed(seed, env.PASSPHRASE), activationAuthorized: false, openingAuthorized: false };
  await journal.save(receipt);
  return receipt;
}
async function main() {
  const env = process.env;
  const role = assertAccountKeyContext(env);
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/environments/${role.environment}`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw Error('Independent environment protection could not be verified');
  assertIndependentProtection(await response.json(), env.INDEPENDENT_REVIEWER_ID);
  const require = createRequire(`${env.KEY_NODE_PATH}/resolve.js`);
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const receipt = await mintOrReadAccountKey(env, githubJournal(env, fetch, {
    branch: 'prod-group-setup', path: `prod-group-setup/${env.KEY_ROLE}-approval-key.json`, label: `${env.KEY_ROLE} approval key`,
  }), Ed25519KeyIdentity);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `## Independent ${env.KEY_ROLE} approval key prepared\n\nPublic key variable \`${role.prefix}_PUBLIC_KEY\`:\n\n${receipt.publicKey}\n\nPrincipal variable \`${role.prefix}_PRINCIPAL\`:\n\n${receipt.principal}\n\nEncrypted secret \`${role.prefix}_SEED_ENC\` (keep in **${role.environment}** only):\n\n\`\`\`text\n${receipt.encryptedSeed}\n\`\`\`\n\nKeep its passphrase in that same independently reviewed environment, never the governor deployment job. No canister, settings, funding, approval or opening changes were made.\n`);
  console.log('Encrypted approval handover prepared; live protections are not activated.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Approval key setup stopped safely: check independent protection, dedicated passphrase and retained receipt. Never retry an unresolved mint.');
  process.exitCode = 1;
});