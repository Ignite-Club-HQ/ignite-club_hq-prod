import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHostBuildEnv, assertProdIdsComplete, assertProdRoutingSnapshot } from './host-build-env.mjs';
import { readFileSync } from 'node:fs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
test('main stays on DEV with the retained public key name', () => {
  const result = resolveHostBuildEnv({ BRANCH: 'main', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' });
  assert.equal(result.IGNITE_LIVE_SUPABASE_URL, 'https://ecsdwrarzfexssxtrymj.supabase.co');
  assert.equal(result.IGNITE_ICP_ENV, 'dev');
});
test('production requires prod and binds only its database', () => {
  const result = resolveHostBuildEnv({ CONTEXT: 'production', BRANCH: 'prod', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_fixture' });
  assert.equal(result.IGNITE_LIVE_SUPABASE_URL, 'https://yabcfiuntwqjwvschnji.supabase.co');
  assert.equal(result.IGNITE_ICP_ENV, 'prod');
  assert.throws(() => resolveHostBuildEnv({ CONTEXT: 'production', BRANCH: 'main', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_fixture' }));
});
test('public key conflicts name the settings without exposing their values', () => {
  const env = { CM_BRANCH: 'prod', IGNITE_ICP_ENV: 'prod', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_prod_fixture', VITE_SUPABASE_ANON_KEY: 'different-private-fixture' };
  assert.throws(() => resolveHostBuildEnv(env), error => {
    assert.match(error.message, /Conflicting public hosting key settings: IGNITE_LIVE_SUPABASE_ANON_KEY, VITE_SUPABASE_ANON_KEY/);
    assert.match(error.message, /Codemagic: supabase_prod/);
    assert.equal(error.message.includes(env.IGNITE_LIVE_SUPABASE_ANON_KEY), false);
    assert.equal(error.message.includes(env.VITE_SUPABASE_ANON_KEY), false);
    return true;
  });
});
test('identical public key aliases remain accepted', () => {
  const key = 'sb_publishable_prod_fixture';
  const result = resolveHostBuildEnv({ CM_BRANCH: 'prod', IGNITE_ICP_ENV: 'prod', IGNITE_LIVE_SUPABASE_ANON_KEY: key, VITE_SUPABASE_ANON_KEY: key });
  assert.equal(result.IGNITE_LIVE_SUPABASE_ANON_KEY, key);
});
test('Codemagic uses the explicitly configured PROD key despite unused aliases', () => {
  const key = 'sb_publishable_prod_fixture';
  const result = resolveHostBuildEnv({ CM_BUILD_ID: 'fixture-build', CM_BRANCH: 'prod', IGNITE_ICP_ENV: 'prod', IGNITE_LIVE_SUPABASE_ANON_KEY: key, VITE_SUPABASE_ANON_KEY: 'legacy-unused-fixture' });
  assert.equal(result.IGNITE_LIVE_SUPABASE_ANON_KEY, key);
  assert.equal(result.IGNITE_LIVE_SUPABASE_URL, 'https://yabcfiuntwqjwvschnji.supabase.co');
});
test('Codemagic still refuses private or DEV canonical keys and conflicting URLs', () => {
  const env = { CM_BUILD_ID: 'fixture-build', CM_BRANCH: 'prod', IGNITE_ICP_ENV: 'prod', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unused' };
  const jwt = payload => `fixture.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
  for (const key of ['sb_secret_private', jwt({ role: 'service_role', ref: 'yabcfiuntwqjwvschnji' }), jwt({ role: 'anon', ref: 'ecsdwrarzfexssxtrymj' })]) {
    assert.throws(() => resolveHostBuildEnv({ ...env, IGNITE_LIVE_SUPABASE_ANON_KEY: key }), /Public publishable or anon key required|Hosting key is private or belongs to another database/);
  }
  assert.throws(() => resolveHostBuildEnv({ ...env, IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_prod', SUPABASE_URL: 'https://ecsdwrarzfexssxtrymj.supabase.co' }), /Conflicting hosting database/);
  assert.throws(() => resolveHostBuildEnv({ ...env, CM_BRANCH: 'main', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_prod' }), /Production hosting must build only the prod branch/);
});
test('missing public key gives a separate actionable error', () => {
  assert.throws(() => resolveHostBuildEnv({ CM_BRANCH: 'prod', IGNITE_ICP_ENV: 'prod' }), /Missing public hosting key: set IGNITE_LIVE_SUPABASE_ANON_KEY to the PROD public key/);
});
test('cross-environment urls and private or conflicting keys refuse', () => {
  const env = { BRANCH: 'main', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
  assert.throws(() => resolveHostBuildEnv({ ...env, SUPABASE_URL: 'https://yabcfiuntwqjwvschnji.supabase.co' }));
  assert.throws(() => resolveHostBuildEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other' }));
  assert.throws(() => resolveHostBuildEnv({ ...env, IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_secret_private' }));
  assert.throws(() => resolveHostBuildEnv({ BRANCH: 'main' }));
});test('PROD build refuses an empty, partial or altered live service table', () => {
  assert.throws(() => assertProdIdsComplete({}));
  const [first] = Object.keys(PROD_CHECK_IDS);
  const partial = { ...PROD_CHECK_IDS }; delete partial[first];
  assert.throws(() => assertProdIdsComplete(partial));
  assert.throws(() => assertProdIdsComplete({ ...PROD_CHECK_IDS, [first]: 'mzzzv-taaaa-aaaal-qxlrq-cai' }));
  assert.equal(Object.keys(PROD_CHECK_IDS).length, 18);
  assert.doesNotThrow(() => assertProdIdsComplete({ ...PROD_CHECK_IDS }));
});
test('PROD build refuses the DEV routing snapshot and accepts an approved PROD one', () => {
  const dev = readFileSync(new URL('../frontend/src/live/generated/routingGates.ts', import.meta.url), 'utf8');
  if (dev.includes(PROD_CHECK_IDS.shard_router)) return; // running on prod branch
  assert.throws(() => assertProdRoutingSnapshot(dev));
  const prod = `"approved": true, "routerCanisterId": "${PROD_CHECK_IDS.shard_router}"`;
  assert.equal(assertProdRoutingSnapshot(prod), PROD_CHECK_IDS.shard_router);
  assert.throws(() => assertProdRoutingSnapshot(prod.replace('true', 'false')));
});
