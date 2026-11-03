import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySavedAccountKey } from './prod-verify-account-key.mjs';
import { mintOrReadAccountKey } from './prod-account-key.mjs';

const seed = '01'.repeat(32); // Non-live fixture only.
const identity = {
  fromSecretKey() { return { getPrincipal() { return { toText() { return 'fixture-approver'; } }; } }; },
  generate() { return { ...this.fromSecretKey(), getKeyPair() { return { secretKey: Buffer.from(seed, 'hex') }; } }; },
};
function context(role) {
  return { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod',
    KEY_ROLE: role, KEY_ENVIRONMENT: `production-${role}-approval`, CONFIRMATION: `CREATE PROD ${role.toUpperCase()} APPROVAL KEY`,
    PASSPHRASE: 'offline fixture phrase never used live', PROD_GOVERNOR_PRINCIPAL: 'fixture-governor', OWNER_REVIEWER_ID: '1' };
}
for (const role of ['account', 'recovery']) {
  test(`${role} verification reads only and cannot mint or save`, async () => {
    const env = context(role);
    let receipt;
    await mintOrReadAccountKey(env, { async load() { return receipt; }, async save(value) { receipt = value; } }, identity);
    const configured = { ...env, EXISTING_ENC: receipt.encryptedSeed, EXISTING_PUBLIC_KEY: receipt.publicKey, EXISTING_PRINCIPAL: receipt.principal };
    let reads = 0;
    const journal = { async load(options) { assert.equal(options.readOnly, true); reads++; return receipt; }, async save() { assert.fail('write attempted'); } };
    const verifier = { fromSecretKey: identity.fromSecretKey, generate() { assert.fail('mint attempted'); } };
    await verifySavedAccountKey(configured, journal, verifier);
    assert.equal(reads, 1);
    await assert.rejects(verifySavedAccountKey(configured, { async load() { return null; } }, verifier));
    await assert.rejects(verifySavedAccountKey({ ...configured, PASSPHRASE: 'different offline fixture phrase long enough' }, journal, verifier));
    for (const name of ['EXISTING_ENC', 'EXISTING_PUBLIC_KEY', 'EXISTING_PRINCIPAL'])
      await assert.rejects(verifySavedAccountKey({ ...configured, [name]: '' }, journal, verifier));
  });
}
