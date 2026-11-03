import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mintOrReadAccountKey } from './prod-account-key.mjs';
import { accountPublicKey, assertAccountKeyContext, assertIndependentProtection, validateAccountPins } from './prod-account-key-policy.mjs';

const seed = '01'.repeat(32); // Credential-free, non-live fixture only.
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod',
  KEY_ROLE: 'account', KEY_ENVIRONMENT: 'production-account-approval', CONFIRMATION: 'CREATE PROD ACCOUNT APPROVAL KEY',
  PASSPHRASE: 'offline test passphrase never used live', PROD_GOVERNOR_PRINCIPAL: 'governor-fixture', GITHUB_ACTOR_ID: '1', OWNER_REVIEWER_ID: '1' };
const fromSecretKey = bytes => ({ getPrincipal: () => ({ toText: () => createHash('sha256').update(bytes).digest('hex') }) });
function fixture(failReady = false) {
  let receipt = null, minted = 0;
  const journal = { async load() { return structuredClone(receipt); }, async save(r) { if (failReady && r.phase === 'encrypted-ready') throw Error('unknown outcome'); receipt = structuredClone(r); } };
  const identity = { fromSecretKey, generate() { assert.equal(receipt.phase, 'mint-pending'); minted++; return { ...fromSecretKey(Buffer.from(seed, 'hex')), getKeyPair: () => ({ secretKey: Buffer.from(seed, 'hex') }) }; } };
  return { journal, identity, count: () => minted, receipt: () => receipt };
}
test('exact PROD role, branch and owner reviewer are required; owner may initiate', () => {
  assert.doesNotThrow(() => assertAccountKeyContext(env));
  for (const change of [{ GITHUB_REF: 'refs/heads/main' }, { IGNITE_ICP_ENV: 'dev' }, { KEY_ROLE: 'unknown' },
    { KEY_ENVIRONMENT: 'production' }, { OWNER_REVIEWER_ID: '' }, { CONFIRMATION: '' }, { PASSPHRASE: 'short' }])
    assert.throws(() => assertAccountKeyContext({ ...env, ...change }));
});
test('owner can approve their own run; administrator bypass and missing owner review are refused', () => {
  const config = { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { id: 1 } }] }] };
  assert.doesNotThrow(() => assertIndependentProtection(config, '1'));
  assert.throws(() => assertIndependentProtection({ ...config, can_admins_bypass: true }, '1'));
  assert.throws(() => assertIndependentProtection(config, '3'));
  assert.throws(() => assertIndependentProtection({ protection_rules: [] }, '1'));
});
test('public pin is the exact Ed25519 key derived from the seed', () => {
  assert.equal(accountPublicKey(seed), '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c');
});
test('intent precedes mint; only ciphertext persists; reruns never remint', async () => {
  const f = fixture(); const first = await mintOrReadAccountKey(env, f.journal, f.identity);
  assert.equal(first.publicKey, accountPublicKey(seed)); assert.equal(first.activationAuthorized, false); assert.equal(first.openingAuthorized, false);
  assert.equal(JSON.stringify(first).includes(seed), false);
  assert.deepEqual(await mintOrReadAccountKey(env, f.journal, f.identity), first); assert.equal(f.count(), 1);
  await assert.rejects(mintOrReadAccountKey({ ...env, PASSPHRASE: 'wrong passphrase long enough to pass context' }, f.journal, f.identity));
  await assert.rejects(mintOrReadAccountKey({ ...env, EXISTING_SEED: seed }, f.journal, f.identity));
  await assert.rejects(mintOrReadAccountKey({ ...env, KEY_ROLE: 'recovery', KEY_ENVIRONMENT: 'production-recovery-approval', CONFIRMATION: 'CREATE PROD RECOVERY APPROVAL KEY' }, f.journal, f.identity));
});
test('lost receipt acknowledgement retains mint lock and prevents replacement', async () => {
  const f = fixture(true); await assert.rejects(mintOrReadAccountKey(env, f.journal, f.identity));
  assert.equal(f.receipt().phase, 'mint-pending'); await assert.rejects(mintOrReadAccountKey(env, f.journal, f.identity)); assert.equal(f.count(), 1);
});
test('altered ciphertext or public pin cannot recover a saved approval key', async () => {
  const f = fixture(); const receipt = await mintOrReadAccountKey(env, f.journal, f.identity);
  const bytes = Buffer.from(receipt.encryptedSeed, 'base64'); bytes[60] ^= 1;
  await f.journal.save({ ...receipt, encryptedSeed: bytes.toString('base64') });
  await assert.rejects(mintOrReadAccountKey(env, f.journal, f.identity));
  await f.journal.save({ ...receipt, publicKey: 'ff'.repeat(32) });
  await assert.rejects(mintOrReadAccountKey(env, f.journal, f.identity)); assert.equal(f.count(), 1);
});
test('each existing credential or public pin independently prevents a new mint', async () => {
  for (const key of ['EXISTING_SEED', 'EXISTING_ENC', 'EXISTING_PUBLIC_KEY', 'EXISTING_PRINCIPAL']) {
    const f = fixture(); await assert.rejects(mintOrReadAccountKey({ ...env, [key]: 'present' }, f.journal, f.identity)); assert.equal(f.count(), 0);
  }
});
test('governor or other approver identity cannot become an approval key', async () => {
  const principal = fromSecretKey(Buffer.from(seed, 'hex')).getPrincipal().toText();
  for (const change of [{ PROD_GOVERNOR_PRINCIPAL: principal }, { OTHER_APPROVER_PRINCIPAL: principal }, { OTHER_APPROVER_PUBLIC_KEY: accountPublicKey(seed) }]) {
    const f = fixture(); await assert.rejects(mintOrReadAccountKey({ ...env, ...change }, f.journal, f.identity));
  }
});
test('production build pins reject same-key roles, colliding witness and wrong identity', () => {
  const ids = { identity_access: 'identity-fixture', shard_router: 'router-fixture' };
  const pins = { version: 1, identity: ids.identity_access, witness: 'witness-fixture', accountPublicKey: accountPublicKey(seed),
    recoveryPublicKey: accountPublicKey('02'.repeat(32)), witnessModuleHash: 'ab'.repeat(32), reviewedSourceCommit: 'a'.repeat(40) };
  assert.equal(validateAccountPins(pins, ids).IGNITE_PRODUCTION_ACCOUNT_WITNESS, pins.witness);
  for (const change of [{ identity: 'wrong' }, { witness: ids.shard_router }, { recoveryPublicKey: pins.accountPublicKey }, { reviewedSourceCommit: '' }])
    assert.throws(() => validateAccountPins({ ...pins, ...change }, ids));
});