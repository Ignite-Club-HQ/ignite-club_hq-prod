import test from 'node:test'; import assert from 'node:assert/strict';
import { assertDevKeyContext } from './dev-approval-key.mjs';
import { mintOrReadAccountKey } from '../prod-account-key.mjs';
const ok = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/main', IGNITE_ICP_ENV: 'dev',
  KEY_ROLE: 'opencloud-dev', KEY_ENVIRONMENT: 'opencloud-dev-approval', CONFIRMATION: 'CREATE OPENCLOUD DEV APPROVAL KEY',
  PASSPHRASE: 'x'.repeat(32), OWNER_REVIEWER_ID: '1', PROD_GOVERNOR_PRINCIPAL: 'a', DEV_DEPLOYER_PRINCIPAL: 'b', OTHER_APPROVER_PRINCIPAL: 'c' };
test('only exact DEV context on main is accepted', () => {
  assert.ok(assertDevKeyContext(ok));
  assert.throws(() => assertDevKeyContext({ ...ok, GITHUB_REF: 'refs/heads/prod' }));
  assert.throws(() => assertDevKeyContext({ ...ok, PASSPHRASE: 'short' }));
  assert.throws(() => assertDevKeyContext({ ...ok, DEV_DEPLOYER_PRINCIPAL: '' }));
});
test('existing key is never replaced', async () => {
  const journal = { load: async () => null, save: async () => {} };
  await assert.rejects(mintOrReadAccountKey({ ...ok, EXISTING_PUBLIC_KEY: 'f'.repeat(64) }, journal, {}, assertDevKeyContext), /replacement refused/);
});
