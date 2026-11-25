// OpenCloud DEV approval key: minted on a GitHub runner inside an owner-reviewed
// environment, sealed with a passphrase held only in that environment. Reuses the
// PROD key implementation; only the context differs. Never activates anything.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubJournal } from '../prod-base-group.mjs';
import { mintOrReadAccountKey } from '../prod-account-key.mjs';
import { assertIndependentProtection } from '../prod-account-key-policy.mjs';

export const DEV_KEY = Object.freeze({ role: 'opencloud-dev', environment: 'opencloud-dev-approval',
  confirmation: 'CREATE OPENCLOUD DEV APPROVAL KEY', branch: 'opencloud-dev-setup', path: 'opencloud-dev-setup/approval-key.json' });

export function assertDevKeyContext(env) {
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.IGNITE_ICP_ENV !== 'dev' || env.KEY_ROLE !== DEV_KEY.role || env.KEY_ENVIRONMENT !== DEV_KEY.environment)
    throw Error('Exact OpenCloud DEV approval context required');
  if (env.CONFIRMATION !== DEV_KEY.confirmation) throw Error('Exact approval key confirmation required');
  if ((env.PASSPHRASE ?? '').length < 32) throw Error('Dedicated approval passphrase of at least 32 characters required');
  if (!/^[0-9]+$/.test(env.OWNER_REVIEWER_ID ?? '')) throw Error('Owner reviewer required');
  // assertIndependentKey reads these names; bind them to every known DEV/PROD signer.
  for (const k of ['PROD_GOVERNOR_PRINCIPAL', 'DEV_DEPLOYER_PRINCIPAL', 'OTHER_APPROVER_PRINCIPAL'])
    if (!env[k]) throw Error(`${k} binding required`);
  return DEV_KEY;
}

async function main() {
  const env = process.env;
  assertDevKeyContext(env);
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/environments/${DEV_KEY.environment}`,
    { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw Error('Independent environment protection could not be verified');
  assertIndependentProtection(await r.json(), env.OWNER_REVIEWER_ID);
  const require = createRequire(`${env.KEY_NODE_PATH}/resolve.js`);
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const receipt = await mintOrReadAccountKey(env, githubJournal(env, fetch,
    { branch: DEV_KEY.branch, path: DEV_KEY.path, label: 'OpenCloud DEV approval key' }), Ed25519KeyIdentity, assertDevKeyContext);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `## OpenCloud DEV approval key prepared\n\nPublic key (send this to Lovable):\n\n${receipt.publicKey}\n\nPrincipal: ${receipt.principal}\n\nThe private key exists only encrypted in the \`${DEV_KEY.path}\` receipt; its passphrase stays in the **${DEV_KEY.environment}** environment. Nothing was installed or activated.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('DEV approval key setup stopped safely. Never retry an unresolved mint; re-running returns the existing key.');
  process.exitCode = 1;
});
