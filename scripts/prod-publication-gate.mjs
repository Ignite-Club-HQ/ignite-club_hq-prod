import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_REPOSITORY = 'Ignite-Club-HQ/ignite-club_hq-prod';
const requirements = [
  ['promote-to-prod.yml', 'Production database deployment'],
  ['promote-icp-prod.yml', 'backend'],
];

export function assertPromotionEvidence(sha, workflow, job, runs, jobsByRun) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Exact production commit required');
  const candidates = runs.filter(run => run.head_sha === sha && run.head_branch === 'prod'
    && run.path === `.github/workflows/${workflow}` && ['push', 'workflow_dispatch'].includes(run.event));
  const latest = candidates.sort((a, b) => b.id - a.id)[0];
  const jobs = latest ? jobsByRun[latest.id] : undefined;
  const matches = jobs?.filter(entry => entry.name === job) ?? [];
  if (!latest || matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
    throw new Error(`Production publication blocked: ${job} has not succeeded for this commit`);
  }
}

/** Read-only GitHub evidence; neither a preflight nor a skipped job authorizes publication. */
export async function verifyProdPublication(env, { databaseOnly = false, fetcher = fetch } = {}) {
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
  for (const [workflow, job] of databaseOnly ? requirements.slice(0, 1) : requirements) {
    const result = await read(`actions/workflows/${workflow}/runs?head_sha=${sha}&branch=prod&per_page=100`);
    if (!Array.isArray(result.workflow_runs) || result.total_count > 100) throw new Error('Incomplete promotion evidence');
    const runs = result.workflow_runs;
    const candidate = runs.filter(run => run.head_sha === sha && run.head_branch === 'prod'
      && run.path === `.github/workflows/${workflow}` && ['push', 'workflow_dispatch'].includes(run.event))
      .sort((a, b) => b.id - a.id)[0];
    const jobsByRun = {};
    if (candidate) {
      const result = await read(`actions/runs/${candidate.id}/jobs?per_page=100`);
      if (!Array.isArray(result.jobs) || result.total_count > 100) throw new Error('Incomplete promotion job evidence');
      jobsByRun[candidate.id] = result.jobs;
    }
    assertPromotionEvidence(sha, workflow, job, runs, jobsByRun);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await verifyProdPublication(process.env, { databaseOnly: process.argv.includes('--database-only') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}