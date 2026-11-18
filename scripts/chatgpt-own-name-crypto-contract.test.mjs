import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEV_CHATGPT_PRIVATE_NAME as dev,
  validateDevOwnNamePreparation, validateReadback,
} from '../frontend/src/live/chatgptOwnNamePolicy.mjs';

const subject = 'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae';
const candidate = (overrides={}) => ({
  appUrl: dev.appUrl,
  derivationOrigin: dev.derivationOrigin,
  piiAuthority: dev.piiAuthority,
  identityAccess: dev.identityAccess,
  callerPrincipal: subject,
  verifiedPrincipal: subject,
  displayName: 'Test3',
  canonicalPrincipal: v => v === subject ? v : (()=>{throw Error('Unknown principal')})(),
  ...overrides,
});

test('only matched authenticated DEV name context can create encryption inputs', () => {
  const p = validateDevOwnNamePreparation(candidate());
  assert.equal(p.subject, subject);
  assert.equal(p.name, 'Test3');
  assert.equal(p.fieldId, 'display_name');
  assert.equal(p.reference, 'pii-display-name:v1:'+dev.piiAuthority+':'+subject);
  assert.deepEqual([...p.ibeIdentity], [...new TextEncoder().encode(subject+'\u001fdisplay_name')]);
  for (const bad of [
    { appUrl: 'https://igniteclubhq.app' },
    { derivationOrigin: 'https://example.com' },
    { piiAuthority: 'wrong-canister' },
    { identityAccess: 'wrong-identity' },
    { verifiedPrincipal: 'another-user' },
    { displayName: '' }, { displayName: ' ' },
    { displayName: 'x'.repeat(81) },
    { displayName: '\u0000Bad' },
  ]) assert.throws(() => validateDevOwnNamePreparation(candidate(bad)));
});

test('a readback requires the same original plaintext and saved private reference', () => {
  const p = validateDevOwnNamePreparation(candidate());
  const confirmed={subject:p.subject,fieldId:p.fieldId,reference:p.reference,plaintext:'Test3',publishedProfileReference:p.reference};
  assert.equal(validateReadback(p,confirmed),true);
  assert.throws(()=>validateReadback(p,{...confirmed,plaintext:'Somebody else'}));
  assert.throws(()=>validateReadback(p,{...confirmed,publishedProfileReference:'Test3'}));
  assert.throws(()=>validateReadback(p,{...confirmed,subject:'other'}));
});

test('ChatGPT bridge encrypts locally with official IBE; it never substitutes a plaintext profile write', () => {
  const source = readFileSync(new URL('../frontend/src/live/chatgptOwnNameCrypto.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '@icp-sdk\/vetkeys'/);
  assert.match(source, /IbeCiphertext\.encrypt\(/);
  assert.match(source, /IbeSeed\.random\(\)/);
  assert.match(source, /IbeIdentity\.fromBytes\(prep\.ibeIdentity\)/);
  assert.match(source, /encrypted_bytes: Array\.from\(encrypted\)/);
  assert.doesNotMatch(source, /actor\.set_profile|actor\.register_pii|fetch\(/);
  assert.doesNotMatch(source, /private.key|secret.key|delegation\s*=/i);
});
