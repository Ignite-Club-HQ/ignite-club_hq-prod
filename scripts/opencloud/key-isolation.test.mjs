import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './deployment.mjs';
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const { Principal } = require('@icp-sdk/core/principal');
const { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed, VetKey } = await import(pathToFileURL(path.join(ROOT, 'frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js')).href);
const { bls12_381 } = require('@noble/curves/bls12-381');
const root = DerivedPublicKey.deserialize(bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true));
const context = new TextEncoder().encode('ignite-pii-v1');
// Official console proxy algorithm: length-tagged actual caller + ORIGINAL context.
// This model is offline evidence only, not verification of the deployed proxy's implementation.
const callerContext = id => {
  const bytes = Principal.fromText(id).toUint8Array();
  return Uint8Array.from([bytes.length, ...bytes, ...context]);
};
test('same console proxy still produces four isolated PII caller contexts across DEV/PROD and G1/G2', () => {
  const configs = ['dev', 'prod'].map(name => JSON.parse(readFileSync(path.join(ROOT, `deploy/opencloud/${name}.json`), 'utf8')));
  assert.equal(configs[0].consoleProxyId, 'ynolw-eyaaa-aaaaj-qspkq-cai');
  assert.equal(configs[1].consoleProxyId, configs[0].consoleProxyId);
  const contexts = configs.flatMap(c => c.groups.map(g => callerContext(g.canisterIds.pii_access_control)));
  const keys = contexts.map(c => Buffer.from(root.deriveSubKey(c).publicKeyBytes()).toString('hex'));
  assert.equal(new Set(keys).size, 4);
  assert.equal(Buffer.from(root.deriveSubKey(contexts[0]).publicKeyBytes()).toString('hex'), keys[0]);
});
test('SDK encrypts bytes under an isolated club identity and refuses an unrelated key', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'deploy/opencloud/dev.json'), 'utf8'));
  const key = root.deriveSubKey(callerContext(config.groups[0].canisterIds.pii_access_control));
  const plaintext = new TextEncoder().encode('offline photo fixture');
  const identity = IbeIdentity.fromBytes(new TextEncoder().encode('clubmedia:offline-club\u001fblob'));
  const bytes = IbeCiphertext.encrypt(key, identity, plaintext, IbeSeed.random()).serialize();
  assert.notDeepEqual(bytes, plaintext);
  const unrelated = VetKey.deserialize(bls12_381.G1.ProjectivePoint.BASE.toRawBytes(true));
  assert.throws(() => IbeCiphertext.deserialize(bytes).decrypt(unrelated));
});