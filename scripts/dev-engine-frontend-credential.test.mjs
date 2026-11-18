import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeExistingDevPublisherPem } from './normalize-dev-engine-publisher-pem.mjs';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const sec1 = privateKey.export({ type: 'sec1', format: 'pem' });
const checked = (source) => createPrivateKey(normalizeExistingDevPublisherPem(source)).export({ format: 'der', type: 'pkcs8' }).toString('hex');

test('pre-existing publisher formats normalize to identical secp256k1 key without rotation', () => {
  const baseline = checked(pem);
  for (const input of [
    pem,
    sec1,
    pem.replace(/\n/g, ' '),
    pem.replace(/\n/g, '\\n'),
    Buffer.from(pem).toString('base64'),
    '"' + pem.replace(/-/g, '\u2014') + '"',
    'owner-principal-record\n' + sec1,
  ]) {
    assert.equal(checked(input), baseline);
  }
});

test('malformed, unrelated algorithm and encrypted key are refused', () => {
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const input of ['', 'jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe', 'BEGIN PRIVATE KEY', other,
    '-----BEGIN ENCRYPTED PRIVATE KEY-----\nAA==\n-----END ENCRYPTED PRIVATE KEY-----']) {
    assert.throws(() => normalizeExistingDevPublisherPem(input), /key|PEM|encrypted/i);
  }
});

test('DEV engine frontend uses the existing public DEV config without new secrets or backend governor', () => {
  const current = readFileSync(new URL('../.github/workflows/deploy-dev-engine-frontend.yml', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('../.github/workflows/deploy-frontend-canister.yml', import.meta.url), 'utf8');
  const pattern = /IGNITE_LIVE_SUPABASE_ANON_KEY: \$\{\{ vars\.IGNITE_LIVE_SUPABASE_ANON_KEY \|\| '([^']+)' \}\}/;
  const oldKey = legacy.match(pattern)?.[1];
  const newKey = current.match(pattern)?.[1];
  assert.ok(oldKey && oldKey.length > 100, 'original DEV public-key fallback exists');
  assert.equal(newKey, oldKey, 'the existing DEV public key is reused byte-for-byte');
  assert.match(current, /node scripts\/normalize-dev-engine-publisher-pem\.mjs/);
  assert.match(current, /icp identity principal --identity engine-dev/);
  assert.match(current, /jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe/);
  assert.match(current, /FRONTEND_CANISTER_ID: 7pfcq-raaaa-aaac5-aabia-cai/);
  assert.doesNotMatch(current, /secrets\.GOVERNOR_PEM|identity new|icp canister install/);
  assert.match(current, /icp sync frontend -e ic/);
  assert.match(current, /permissions:\s*\n\s*contents: read/);
});
