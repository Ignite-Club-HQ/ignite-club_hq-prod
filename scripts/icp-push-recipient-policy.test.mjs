import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipientAllowlist, parseMaxAgeMs, deliveryDecision } from './icp-push-recipient-policy.mjs';
import { sealPushSeed } from './prod-push-key-policy.mjs';
import { resolveProdWorkerSeed } from './prod-push-config.mjs';

const parse = id => ({ toText: () => id });
const now = 10_000_000;
const item = (user, ageMs = 0) => ({ user, created_at_ms: BigInt(now - ageMs) });

test('only the approved recipient is sent to', () => {
  const allow = parseRecipientAllowlist('["paul"]', parse);
  assert.equal(deliveryDecision(item('paul'), now, allow, null), 'send');
  assert.equal(deliveryDecision(item('someone-else'), now, allow, null), 'skip_recipient');
});
test('alerts older than 30 minutes are not sent', () => {
  const allow = parseRecipientAllowlist('["paul"]', parse);
  const max = parseMaxAgeMs(String(30 * 60 * 1000));
  assert.equal(deliveryDecision(item('paul', 29 * 60 * 1000), now, allow, max), 'send');
  assert.equal(deliveryDecision(item('paul', 31 * 60 * 1000), now, allow, max), 'skip_stale');
});
test('TEST (no list, no age limit) keeps sending everyone', () => {
  assert.equal(parseRecipientAllowlist(undefined, parse), null);
  assert.equal(deliveryDecision(item('anyone', 10 * 24 * 3600 * 1000), now, null, null), 'send');
});
test('encrypted PROD key decrypts only with matching recorded principal', () => {
  const seed = 'ab'.repeat(32);
  const enc = sealPushSeed(seed, 'p'.repeat(40));
  const identityType = { fromSecretKey: () => ({ getPrincipal: () => ({ toText: () => 'worker' }) }) };
  const env = { PROD_ICP_PUSH_WORKER_SEED_ENC: enc, PROD_ICP_PUSH_WORKER_PASSPHRASE: 'p'.repeat(40), PROD_ICP_PUSH_WORKER_PRINCIPAL: 'worker' };
  assert.equal(resolveProdWorkerSeed(env, identityType), seed);
  assert.throws(() => resolveProdWorkerSeed({ ...env, PROD_ICP_PUSH_WORKER_PRINCIPAL: 'other' }, identityType));
  assert.throws(() => resolveProdWorkerSeed({ ...env, PROD_ICP_PUSH_WORKER_PASSPHRASE: 'q'.repeat(40) }, identityType));
});
