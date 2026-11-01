import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertPushKeyContext, assertNoStoredPushKey, sealPushSeed, openPushSeed, resolveProdPushPrincipal } from './prod-push-key-policy.mjs';
import { mintOrReadPushKey } from './prod-push-key.mjs';

// Explicit non-live deterministic fixture: no real signing material is minted locally.
const seed = '01'.repeat(32), pass = 'offline fixture passphrase not a live credential';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod',
  IGNITE_ICP_ENV: 'prod', ACTION_CONFIRM: 'CREATE PROD PUSH KEY', PASSPHRASE: pass, PROD_ICP_PUSH_ENABLED: 'false' };
const principal = value => createHash('sha256').update(value).digest('hex');
const fakeIdentity = { fromSecretKey: bytes => ({ getPrincipal: () => ({ toText: () => principal(bytes) }) }) };
function identityFactory() {
  let calls = 0;
  return { ...fakeIdentity, generate() { calls++; return { ...fakeIdentity.fromSecretKey(Buffer.from(seed, 'hex')), getKeyPair: () => ({ secretKey: Buffer.from(seed, 'hex') }) }; }, count: () => calls };
}
function journal(initial = null, failReady = false) {
  let receipt = initial;
  return { async load() { return receipt; }, async save(value) {
    if (failReady && value.phase === 'encrypted-ready') throw new Error('lost reply');
    receipt = structuredClone(value);
  }, current: () => receipt };
}
test('only the exact live PROD branch can mint', () => {
  assert.doesNotThrow(() => assertPushKeyContext(env));
  for (const change of [{ GITHUB_REF: 'refs/heads/main' }, { IGNITE_ICP_ENV: 'dev' }, { GITHUB_REPOSITORY: 'other/repo' }])
    assert.throws(() => assertPushKeyContext({ ...env, ...change }));
});
test('delivery must stay off', () => assert.throws(() => assertPushKeyContext({ ...env, PROD_ICP_PUSH_ENABLED: 'true' })));
test('mint requires exact confirmation', () => assert.throws(() => assertPushKeyContext({ ...env, ACTION_CONFIRM: '' })));
test('32-character minimum passphrase', () => {
  assert.throws(() => assertPushKeyContext({ ...env, PASSPHRASE: 'x'.repeat(31) }));
  assert.doesNotThrow(() => assertPushKeyContext({ ...env, PASSPHRASE: 'x'.repeat(32) }));
});
test('each existing key setting independently refuses replacement', () => {
  for (const key of ['EXISTING_SEED', 'EXISTING_ENC', 'EXISTING_PRINCIPAL']) assert.throws(() => assertNoStoredPushKey({ [key]: 'present' }));
});
test('encrypted handover round-trips; wrong passphrase and tampering fail', () => {
  const blob = sealPushSeed(seed, pass);
  assert.equal(openPushSeed(blob, pass), seed);
  assert.equal(blob.includes(seed), false);
  assert.throws(() => openPushSeed(blob, 'wrong'));
  const bytes = Buffer.from(blob, 'base64'); bytes[60] ^= 1;
  assert.throws(() => openPushSeed(bytes.toString('base64'), pass));
});
test('intent precedes generation, only encrypted seed persists', async () => {
  const j = journal(), identity = identityFactory();
  const originalGenerate = identity.generate;
  identity.generate = () => { assert.equal(j.current().phase, 'mint-pending'); return originalGenerate(); };
  const result = await mintOrReadPushKey(env, j, identity);
  assert.equal(result.phase, 'encrypted-ready');
  assert.equal(result.deliveryEnabled, false);
  assert.equal(JSON.stringify(result).includes(seed), false);
  assert.equal(openPushSeed(result.encryptedSeed, pass), seed);
});
test('rerun recovers exactly the original encrypted handover without reminting', async () => {
  const j = journal(), identity = identityFactory();
  const first = await mintOrReadPushKey(env, j, identity);
  const second = await mintOrReadPushKey({ ...env, EXISTING_ENC: first.encryptedSeed }, j, identity);
  assert.deepEqual(second, first);
  assert.equal(identity.count(), 1);
});
test('lost ready receipt leaves intent locked, never creates another key', async () => {
  const j = journal(null, true), identity = identityFactory();
  await assert.rejects(mintOrReadPushKey(env, j, identity));
  assert.equal(j.current().phase, 'mint-pending');
  await assert.rejects(mintOrReadPushKey(env, j, identity));
  assert.equal(identity.count(), 1);
});
test('closed group resolves verified encrypted PROD identity only', () => {
  const p = principal(Buffer.from(seed, 'hex'));
  const config = { PROD_ICP_PUSH_WORKER_SEED_ENC: sealPushSeed(seed, pass), PROD_ICP_PUSH_WORKER_PASSPHRASE: pass, PROD_ICP_PUSH_WORKER_PRINCIPAL: p };
  assert.equal(resolveProdPushPrincipal(config, fakeIdentity), p);
  for (const change of [{ PROD_ICP_PUSH_WORKER_PRINCIPAL: 'other' }, { PROD_ICP_PUSH_WORKER_PASSPHRASE: 'wrong' },
    { DEV_PUSH_WORKER_PRINCIPAL: p }, { PROD_GOVERNOR_PRINCIPAL: p }, { PROD_ICP_PUSH_WORKER_SEED: seed }])
    assert.throws(() => resolveProdPushPrincipal({ ...config, ...change }, fakeIdentity));
});