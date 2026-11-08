import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_REPOSITORY = 'Ignite-Club-HQ/ignite-club_hq-prod';
// Bookkeeping commits written by promote-icp-prod.yml after a successful upgrade.
// They carry [skip ci], so no promotion runs for them; evidence is read from their parent.
export const RELEASE_RECORD_MESSAGE = 'Record PROD canister release [skip ci]';
export const RELEASE_RECORD_FILES = new Set(['deploy/prod/release.json', 'deploy/prod/.icp/data/mappings/ic.ids.json', 'deploy/frontend-prod/.icp/data/mappings/ic.ids.json']);
const MAX_RECORD_HOPS = 3;

/** Returns the parent when `commit`/`comparison` prove a pure release-record commit, else null. */
export function releaseRecordParent(commit, comparison) {
  const message = commit?.commit?.message ?? '';
  const author = commit?.commit?.author?.name;
  const parents = commit?.parents ?? [];
  if (message.trim() !== RELEASE_RECORD_MESSAGE || author !== 'github-actions[bot]' || parents.length !== 1) return null;
  const files = comparison?.files;
  if (!Array.isArray(files) || !files.length || comparison.ahead_by !== 1 || comparison.behind_by !== 0) return null;
  if (!files.every(file => RELEASE_RECORD_FILES.has(file.filename) && file.status === 'modified')) return null;
  const parent = parents[0]?.sha;
  return /^[a-f0-9]{40}$/.test(parent ?? '') ? parent : null;
}

const requirements = [
  ['promote-to-prod.yml', 'Production database deployment'],
  ['promote-icp-prod.yml', 'backend'],
];

export function assertPromotionEvidence(sha, workflow, job, runs, jobsByRun) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Exact production commit required');
  const candidates = runs.filter(run => run.head_sha === sha && run.head_branch === 'prod'
    && run.path === `.github/workflows/${workflow}` && ['push', 'workflow_dispatch'].includes(run.event));
  const ok = candidates.some(run => {
    const matches = (jobsByRun[run.id] ?? []).filter(entry => entry.name === job);
    return matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success';
  });
  if (!ok) {
    const seen = candidates.map(run => `${run.id}:${run.event}:${run.status}/${run.conclusion}:[${(jobsByRun[run.id] ?? []).map(j => `${j.name}=${j.conclusion}`).join(',')}]`).join(' ');
    throw new Error(`Production publication blocked: ${job} has not succeeded for this commit (runs seen: ${seen || 'none'})`);
  }
}

/** Read-only GitHub evidence; neither a preflight nor a skipped job authorizes publication. */
export async function verifyProdPublication(env, { databaseOnly = false, fetcher = fetch, waitMs = 0, pollMs = 30000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const sha = env.COMMIT_REF || env.CM_COMMIT || env.GITHUB_SHA;
  const branch = env.BRANCH || env.CM_BRANCH || env.GITHUB_REF_NAME;
  if (branch !== 'prod' || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Publication requires the exact prod source commit');
  const headers = { Accept: 'application/vnd.github+json' };
  if (env.PROD_RELEASE_READ_TOKEN) headers.Authorization = `Bearer ${env.PROD_RELEASE_READ_TOKEN}`;
  const read = async endpoint => {
    const response = await fetcher(`https://api.github.com/repos/${RELEASE_REPOSITORY}/${endpoint}`, {
      headers, signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Production promotion evidence unavailable; publication blocked');
    return response.json();
  };
  let evidenceSha = sha;
  for (let hop = 0; hop < MAX_RECORD_HOPS; hop++) {
    const commit = await read(`commits/${evidenceSha}`);
    const parent = commit?.parents?.length === 1 ? commit.parents[0].sha : null;
    if (!parent || (commit?.commit?.message ?? '').trim() !== RELEASE_RECORD_MESSAGE) break;
    const next = releaseRecordParent(commit, await read(`compare/${parent}...${evidenceSha}`));
    if (!next) break;
    evidenceSha = next;
  }
  const deadline = Date.now() + waitMs;
  for (const [workflow, job] of databaseOnly ? requirements.slice(0, 1) : requirements) {
   for (;;) {
    const result = await read(`actions/workflows/${workflow}/runs?head_sha=${evidenceSha}&branch=prod&per_page=100`);
    if (!Array.isArray(result.workflow_runs) || result.total_count > 100) throw new Error('Incomplete promotion evidence');
    const runs = result.workflow_runs;
    const candidates = runs.filter(run => run.head_sha === evidenceSha && run.head_branch === 'prod'
      && run.path === `.github/workflows/${workflow}` && ['push', 'workflow_dispatch'].includes(run.event))
      .sort((a, b) => b.id - a.id).slice(0, 5);
    const candidate = candidates[0];
    const jobsByRun = {};
    for (const run of candidates) {
      const result = await read(`actions/runs/${run.id}/jobs?per_page=100`);
      if (!Array.isArray(result.jobs) || result.total_count > 100) throw new Error('Incomplete promotion job evidence');
      jobsByRun[run.id] = result.jobs;
    }
    // Wait only while the promotion is still missing or running; a finished failure blocks at once.
    const pending = !candidate || candidate.status !== 'completed';
    if (pending && Date.now() + pollMs <= deadline) {
      console.log(`Waiting for ${job} to finish for ${evidenceSha.slice(0, 7)}...`);
      await sleep(pollMs);
      continue;
    }
    assertPromotionEvidence(evidenceSha, workflow, job, runs, jobsByRun);
    break;
   }
  }
}

/** CLI wait for in-flight promotion runs, in ms; invalid values mean no wait. */
export function cliWaitMs(env) {
  const value = Number(env.PROD_PUBLICATION_GATE_WAIT_MS ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await verifyProdPublication(process.env, { databaseOnly: process.argv.includes('--database-only'), waitMs: cliWaitMs(process.env) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}