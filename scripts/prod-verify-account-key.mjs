import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { githubJournal } from './prod-base-group.mjs';
import { mintOrReadAccountKey } from './prod-account-key.mjs';
import { ACCOUNT_KEY_ROLES, assertAccountKeyContext, assertIndependentProtection, openAccountSeed } from './prod-account-key-policy.mjs';

export async function verifySavedAccountKey(env, journal, identityType) {
  assertAccountKeyContext(env);
  if (!env.EXISTING_ENC || !env.EXISTING_PUBLIC_KEY || !env.EXISTING_PRINCIPAL || env.EXISTING_SEED)
    throw Error('Saved configuration required');
  const receipt = await journal.load({ readOnly: true });
  if (!receipt) throw Error('Original receipt required');
  const readOnlyJournal = {
    async load() { return receipt; },
    async save() { throw Error('Verification cannot write'); },
  };
  const readOnlyIdentity = {
    fromSecretKey: bytes => identityType.fromSecretKey(bytes),
    generate() { throw Error('Verification cannot mint'); },
  };
  await mintOrReadAccountKey(env, readOnlyJournal, readOnlyIdentity);
}

async function main() {
  let stage = 'execution context';
  try {
    const env = process.env;
    assertAccountKeyContext(env);
    console.log('Execution context accepted.');
    stage = 'GitHub environment read';
    const role = ACCOUNT_KEY_ROLES[env.KEY_ROLE];
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/environments/${role.environment}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw Error('Environment unavailable');
    stage = 'owner approval protection';
    assertIndependentProtection(await response.json(), env.OWNER_REVIEWER_ID);
    console.log('Owner approval protection accepted.');
    stage = 'identity library loading';
    const require = createRequire(`${env.KEY_NODE_PATH}/resolve.js`);
    const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
    console.log('Identity library loaded.');
    stage = 'original receipt read';
    const journal = githubJournal(env, fetch, {
      branch: 'prod-group-setup', path: `prod-group-setup/${env.KEY_ROLE}-approval-key.json`,
    });
    const receipt = await journal.load({ readOnly: true });
    if (!receipt || receipt.version !== 1 || receipt.role !== env.KEY_ROLE || receipt.repository !== env.GITHUB_REPOSITORY || receipt.phase !== 'encrypted-ready')
      throw Error('Original completed receipt unavailable');
    console.log('Original completed receipt available.');
    // Fixed-label sub-checks: report which saved item disagrees, never its value.
    stage = 'saved public details match original';
    if (env.EXISTING_PUBLIC_KEY !== receipt.publicKey || env.EXISTING_PRINCIPAL !== receipt.principal) throw Error('mismatch');
    console.log('Saved public details match original.');
    stage = 'saved encrypted block matches original';
    if ((env.EXISTING_ENC || '') !== receipt.encryptedSeed) {
      const sameIgnoringSpacing = (env.EXISTING_ENC || '').replace(/\s+/g, '') === receipt.encryptedSeed;
      stage = sameIgnoringSpacing ? 'saved encrypted block has extra spaces or line breaks' : 'saved encrypted block differs from original';
      throw Error('mismatch');
    }
    console.log('Saved encrypted block matches original exactly.');
    stage = 'saved passphrase unlocks original key';
    try { openAccountSeed(receipt.encryptedSeed, env.PASSPHRASE); } catch {
      const trimmed = (env.PASSPHRASE || '').trim();
      let trimmedWorks = false;
      if (trimmed !== env.PASSPHRASE) { try { openAccountSeed(receipt.encryptedSeed, trimmed); trimmedWorks = true; } catch {} }
      stage = trimmedWorks ? 'saved passphrase has extra spaces or line breaks' : 'saved passphrase does not unlock original key';
      throw Error('mismatch');
    }
    console.log('Saved passphrase unlocks original key.');
    stage = 'saved approval verification';
    await verifySavedAccountKey(env, { async load() { return receipt; } }, Ed25519KeyIdentity);
    console.log('Saved approval verification passed. No keys, receipts, canisters or settings changed.');
  } catch {
    // Stage labels are locally defined; never print errors, values or comparisons.
    console.error(`Verification stopped at: ${stage}. No mint or write was attempted.`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
