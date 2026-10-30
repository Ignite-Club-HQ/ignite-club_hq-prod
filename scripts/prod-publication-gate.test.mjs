import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProdPublication } from './prod-publication-gate.mjs';
const sha = 'a'.repeat(40);
const env = { CM_BRANCH: 'prod', CM_COMMIT: sha };
function reader(change = {}) {
  return async url => {
    const workflow = url.includes('promote-to-prod') ? 'promote-to-prod.yml' : 'promote-icp-prod.yml';
    const id = workflow === 'promote-to-prod.yml' ? 1 : 2;
    const data = url.includes('/jobs?')
      ? { total_count: 1, jobs: [{ name: url.includes('/1/') ? 'Production database deployment' : 'backend', status: 'completed', conclusion: 'success', ...change.job }] }
      : { total_count: 1, workflow_runs: [{ id, path: `.github/workflows/${workflow}`, head_sha: sha, head_branch: 'prod', event: 'push', ...change.run }] };
    return { ok: change.ok !== false, json: async () => data };
  };
}
test('exact commit requires both real successful promotion jobs', async () => {
  await verifyProdPublication(env, { fetcher: reader() });
});
for (const [name, change] of [
  ['wrong commit', { run: { head_sha: 'b'.repeat(40) } }],
  ['main branch evidence', { run: { head_branch: 'main' } }],
  ['PR evidence', { run: { event: 'pull_request' } }],
  ['other workflow', { run: { path: '.github/workflows/ci.yml' } }],
  ['failed promotion', { job: { conclusion: 'failure' } }],
  ['skipped promotion', { job: { conclusion: 'skipped' } }],
  ['unfinished promotion', { job: { status: 'in_progress' } }],
  ['preflight is not deployment', { job: { name: 'Database release preflight (no writes)' } }],
  ['inaccessible evidence', { ok: false }],
]) test(`blocks ${name}`, async () => {
  await assert.rejects(verifyProdPublication(env, { fetcher: reader(change) }));
});
test('missing or short source revision and non-prod source fail before retrieval', async () => {
  let calls = 0;
  for (const bad of [{ CM_COMMIT: '' }, { CM_COMMIT: 'aaaaaaa' }, { CM_BRANCH: 'main' }]) {
    await assert.rejects(verifyProdPublication({ ...env, ...bad }, { fetcher: async () => { calls++; } }));
  }
  assert.equal(calls, 0);
});
test('ICP frontend checks database only to avoid waiting on itself', async () => {
  let requests = 0;
  await verifyProdPublication(env, { databaseOnly: true, fetcher: async url => { requests++; assert.doesNotMatch(url, /promote-icp/); return reader()(url); } });
  assert.equal(requests, 2);
});