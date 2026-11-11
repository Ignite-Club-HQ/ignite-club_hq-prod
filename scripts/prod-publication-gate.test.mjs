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
      : { total_count: 1, workflow_runs: [{ id, path: `.github/workflows/${workflow}`, head_sha: sha, head_branch: 'prod', event: 'push', status: 'completed', ...change.run }] };
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
  assert.equal(requests, 3);
});
const parentSha = 'c'.repeat(40);
function recordReader({ message = 'Record PROD canister release [skip ci]', author = 'github-actions[bot]', files = [{ filename: 'deploy/prod/release.json', status: 'modified' }] } = {}) {
  return async url => {
    let data;
    if (url.includes(`/commits/${sha}`)) data = { commit: { message, author: { name: author } }, parents: [{ sha: parentSha }] };
    else if (url.includes('/commits/')) data = { commit: { message: 'Merge pull request' }, parents: [{ sha: 'd'.repeat(40) }, { sha: 'e'.repeat(40) }] };
    else if (url.includes('/compare/')) data = { ahead_by: 1, behind_by: 0, files };
    else {
      const workflow = url.includes('promote-to-prod') ? 'promote-to-prod.yml' : 'promote-icp-prod.yml';
      const id = workflow === 'promote-to-prod.yml' ? 1 : 2;
      data = url.includes('/jobs?')
        ? { total_count: 1, jobs: [{ name: url.includes('/1/') ? 'Production database deployment' : 'backend', status: 'completed', conclusion: 'success' }] }
        : { total_count: 1, workflow_runs: [{ id, path: `.github/workflows/${workflow}`, head_sha: parentSha, head_branch: 'prod', event: 'push', status: 'completed' }] };
    }
    return { ok: true, json: async () => data };
  };
}
test('release-record bookkeeping commit uses its parent merge evidence', async () => {
  await verifyProdPublication(env, { fetcher: recordReader() });
});
for (const [name, change] of [
  ['human-authored record message', { author: 'Someone' }],
  ['other message', { message: 'Update release.json [skip ci]' }],
  ['record commit touching code', { files: [{ filename: 'deploy/prod/release.json', status: 'modified' }, { filename: 'frontend/src/App.tsx', status: 'modified' }] }],
]) test(`does not inherit parent evidence for ${name}`, async () => {
  await assert.rejects(verifyProdPublication(env, { fetcher: recordReader(change) }));
});

test('waits while promotion is still running, then publishes', async () => {
  let polls = 0;
  const base = reader();
  const fetcher = async url => {
    if (url.includes('/runs?') && url.includes('promote-to-prod') && polls < 2) {
      return { ok: true, json: async () => ({ total_count: 1, workflow_runs: [{ id: 1, path: '.github/workflows/promote-to-prod.yml', head_sha: sha, head_branch: 'prod', event: 'push', status: 'in_progress' }] }) };
    }
    return base(url);
  };
  await verifyProdPublication(env, { fetcher, waitMs: 60000, pollMs: 1, sleep: async () => { polls++; } });
  assert.equal(polls, 2);
});
test('finished failure blocks without waiting', async () => {
  let polls = 0;
  await assert.rejects(verifyProdPublication(env, { fetcher: reader({ run: { status: 'completed' }, job: { conclusion: 'failure' } }), waitMs: 60000, pollMs: 1, sleep: async () => { polls++; } }));
  assert.equal(polls, 0);
});

test('CLI wait defaults to 10 minutes, overridable by PROD_PUBLICATION_GATE_WAIT_MS', async () => {
  const { cliWaitMs } = await import('./prod-publication-gate.mjs');
  assert.equal(cliWaitMs({}), 600000);
  assert.equal(cliWaitMs({ PROD_PUBLICATION_GATE_WAIT_MS: '720000' }), 720000);
  assert.equal(cliWaitMs({ PROD_PUBLICATION_GATE_WAIT_MS: 'abc' }), 0);
  assert.equal(cliWaitMs({ PROD_PUBLICATION_GATE_WAIT_MS: '-5' }), 0);
});

test('an earlier successful run for the same commit still counts', async () => {
  const { assertPromotionEvidence } = await import('./prod-publication-gate.mjs');
  const sha = 'a'.repeat(40);
  const base = { head_sha: sha, head_branch: 'prod', path: '.github/workflows/promote-to-prod.yml', event: 'push' };
  const runs = [{ ...base, id: 1 }, { ...base, id: 2, event: 'workflow_dispatch' }];
  const jobsByRun = { 1: [{ name: 'Production database deployment', status: 'completed', conclusion: 'success' }], 2: [{ name: 'Production database deployment', status: 'completed', conclusion: 'skipped' }] };
  assert.doesNotThrow(() => assertPromotionEvidence(sha, 'promote-to-prod.yml', 'Production database deployment', runs, jobsByRun));
});

test('GitHub read limit waits for reset inside the wait budget, then publishes', async () => {
  let limited = 1, slept = 0;
  const base = reader();
  const headers = new Map([['x-ratelimit-remaining', '0'], ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 5)]]);
  const fetcher = async url => limited-- > 0 ? { ok: false, status: 403, headers, json: async () => ({}) } : base(url);
  await verifyProdPublication(env, { fetcher, waitMs: 600000, pollMs: 1, sleep: async () => { slept++; } });
  assert.equal(slept, 1);
});
test('GitHub read limit beyond the wait budget still blocks', async () => {
  const headers = new Map([['x-ratelimit-remaining', '0'], ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)]]);
  await assert.rejects(verifyProdPublication(env, { fetcher: async () => ({ ok: false, status: 403, headers }), waitMs: 60000, sleep: async () => {} }), /read limit/);
});
test('a plain 403 refusal is not treated as a read limit', async () => {
  await assert.rejects(verifyProdPublication(env, { fetcher: async () => ({ ok: false, status: 403, headers: new Map() }), waitMs: 600000, sleep: async () => {} }), /evidence unavailable; publication blocked/);
});
test('polling a running promotion reads only the run list', async () => {
  let polls = 0, jobReadsWhilePending = 0;
  const base = reader();
  const fetcher = async url => {
    if (url.includes('promote-to-prod') && polls < 3) {
      return { ok: true, json: async () => ({ total_count: 1, workflow_runs: [{ id: 1, path: '.github/workflows/promote-to-prod.yml', head_sha: sha, head_branch: 'prod', event: 'push', status: 'in_progress' }] }) };
    }
    if (url.includes('/jobs?') && polls < 3) jobReadsWhilePending++;
    return base(url);
  };
  await verifyProdPublication(env, { fetcher, waitMs: 600000, pollMs: 1, sleep: async () => { polls++; } });
  assert.equal(polls, 3);
  assert.equal(jobReadsWhilePending, 0);
});
