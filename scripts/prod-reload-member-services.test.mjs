import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadTargets, assertReloadReady } from './prod-reload-member-services-policy.mjs';

const targets = Array.from({ length: 24 }, (_, i) => ({ name: i % 2 ? 'club_domain' : 'media_blob_store', id: `id${i}`, group: i < 12 ? 'base' : 'g2' }));
const receipt = { phase: 'settings-applied', plan: { targets } };
const okEnv = [{ name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: 'ident' }, { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' }];
const status = Object.fromEntries(targets.map(t => [t.id, { controllers: ['gov'], moduleHash: 'h', environment: okEnv }]));
const builds = { club_domain: { hashes: ['h'] }, media_blob_store: { hashes: ['x', 'h'] } };

test('requires applied settings and exactly 24 services', () => {
  assert.throws(() => reloadTargets({ phase: 'planned', plan: { targets } }), /applied/);
  assert.throws(() => reloadTargets({ phase: 'settings-applied', plan: { targets: targets.slice(1) } }), /twenty-four/);
  assert.equal(reloadTargets(receipt).length, 24);
});

test('ready when every live module matches the build and settings are present', () => {
  assert.doesNotThrow(() => assertReloadReady({ targets, status, builds, governor: 'gov', identity: 'ident' }));
});

test('refuses when any live code differs from the build', () => {
  const s = { ...status, id3: { ...status.id3, moduleHash: 'other' } };
  assert.throws(() => assertReloadReady({ targets, status: s, builds, governor: 'gov', identity: 'ident' }), /differs/);
});

test('refuses when settings are missing or controller is not the governor', () => {
  const s = { ...status, id4: { ...status.id4, environment: [] }, id5: { ...status.id5, controllers: ['gov', 'x'] } };
  assert.throws(() => assertReloadReady({ targets, status: s, builds, governor: 'gov', identity: 'ident' }), /settings missing.*sole controller|sole controller.*settings missing/);
});
