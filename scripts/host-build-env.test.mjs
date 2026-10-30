import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHostBuildEnv } from './host-build-env.mjs';
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
test('cross-environment urls and private or conflicting keys refuse', () => {
  const env = { BRANCH: 'main', IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
  assert.throws(() => resolveHostBuildEnv({ ...env, SUPABASE_URL: 'https://yabcfiuntwqjwvschnji.supabase.co' }));
  assert.throws(() => resolveHostBuildEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other' }));
  assert.throws(() => resolveHostBuildEnv({ ...env, IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_secret_private' }));
  assert.throws(() => resolveHostBuildEnv({ BRANCH: 'main' }));
});