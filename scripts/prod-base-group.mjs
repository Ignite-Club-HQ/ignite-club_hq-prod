import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText } from './prod-connection-check-policy.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { assertBaseContext, buildBasePlan, assertReviewedPlan, hashPlan, registerClosedBase, RECEIPTS_BRANCH, RECEIPT_PATH } from './prod-base-group-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unwrap = r => { if ('Err' in r) throw new Error('Infrastructure operation refused; inspect signed readback, never replay'); return r.Ok; };

// Only locally defined labels are public; never emit arbitrary agent/API errors.
export function baseFailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Live inventory, modules, controller, subnet or revision changed; re-plan',
    'Reviewed plan hash required (64 lowercase hex characters)',
    'Reviewed plan hash does not match the saved plan receipt',
    'Persisted reviewed plan required',
    'Existing receipt requires read-only reconciliation; no replay',
    'Initial closed base registration requires empty complete registry',
    'Journal acknowledgement mismatch; stop without replay',
    'Journal readback failed; stop without replay',
    'Infrastructure operation refused; inspect signed readback, never replay',
    'Closed registry readback mismatch; stop without replay',
  ];
  if (known.includes(message)) return message;
  if (/^GitHub journal (GET|POST|PUT) failed \([0-9]{3}\); stop without replay$/.test(message)) return message;
  return 'Unclassified failure; inspect the saved stage and receipt without retrying registration';
}
let stage = 'startup';
export function saveBaseFailure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: baseFailureReason(error), retryAuthorized: false };
  const message = `### PROD base setup stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry registration until the durable receipt is reviewed.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

// GitHub journal writes are never retried. Read the acknowledged commit, not
// a possibly lagging branch head; never log credentials or response bodies.
export function githubJournal(env, fetcher = fetch) {
  const repo = 'Ignite-Club-HQ/ignite-club_hq-prod';
  if (env.GITHUB_REPOSITORY !== repo || !env.GH_TOKEN) throw new Error('Live repository journal authorization required');
  const api = async (endpoint, method = 'GET', body, missing = false) => {
    const r = await fetcher(`https://api.github.com/repos/${repo}/${endpoint}`, { method,
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (missing && r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub journal ${method} failed (${r.status}); stop without replay`);
    return r.json();
  };
  let stored;
  return {
    async load({ readOnly = false } = {}) {
      let ref = await api(`git/ref/heads/${RECEIPTS_BRANCH}`, 'GET', undefined, true);
      if (!ref) {
        if (readOnly) return null;
        ref = await api('git/refs', 'POST', { ref: `refs/heads/${RECEIPTS_BRANCH}`, sha: env.GITHUB_SHA });
        if (ref.object?.sha !== env.GITHUB_SHA) throw new Error('Receipt branch acknowledgement mismatch');
      }
      stored = await api(`contents/${RECEIPT_PATH}?ref=${ref.object.sha}`, 'GET', undefined, true);
      if (!stored) return null;
      if (stored.encoding !== 'base64') throw new Error('Unsupported receipt encoding');
      return JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8'));
    },
    async save(receipt) {
      const bytes = Buffer.from(evidenceText(receipt));
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      const ack = await api(`contents/${RECEIPT_PATH}`, 'PUT', { branch: RECEIPTS_BRANCH,
        message: `PROD closed base ${receipt.pending ?? receipt.phase} receipt [skip ci]`, content: bytes.toString('base64'),
        ...(stored ? { sha: stored.sha } : {}) });
      if (!/^[a-f0-9]{40}$/.test(ack.commit?.sha ?? '') || ack.content?.sha !== sha)
        throw new Error('Journal acknowledgement mismatch; stop without replay');
      const readback = await api(`contents/${RECEIPT_PATH}?ref=${ack.commit.sha}`);
      if (readback.sha !== sha || readback.encoding !== 'base64' || !Buffer.from(readback.content, 'base64').equals(bytes))
        throw new Error('Journal readback failed; stop without replay');
      stored = readback;
    },
  };
}

async function main() {
  const env = process.env, action = env.BASE_ACTION;
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  stage = 'context and signing identity';
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor, CanisterStatus } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  assertBaseContext(ids, env, principal, action);
  stage = 'certified infrastructure readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const contract = groupContract(IDL);
  const router = Actor.createActor(action === 'register-closed' ? contract.closedRegistrar : contract.reader,
    { agent, canisterId: ids.shard_router });
  const readRegistry = async revision => unwrap(await router.read_group_registry_page('mainnet', revision === undefined ? [] : [revision], [], 64));
  const observations = [];
  for (const name of Object.keys(ids).sort()) {
    const status = await CanisterStatus.request({ agent, canisterId: Principal.fromText(ids[name]), paths: ['controllers', 'module_hash', 'subnet'] });
    const module = status.get('module_hash');
    observations.push({ name, id: ids[name], moduleHash: typeof module === 'string' ? module : Buffer.from(module ?? []).toString('hex'),
      controllers: (status.get('controllers') ?? []).map(p => p.toText()), subnet: status.get('subnet')?.subnetId });
  }
  const page = await readRegistry();
  stage = 'load durable receipt';
  const journal = githubJournal(env);
  const receipt = await journal.load({ readOnly: action === 'inspect' });
  if (receipt) writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-receipt.json'), evidenceText(receipt));
  if (action === 'inspect') {
    const report = { receiptPhase: receipt?.phase ?? 'missing', pending: receipt?.pending ?? null,
      savedSourceCommit: receipt?.plan?.sourceCommit ?? null, currentSourceCommit: env.GITHUB_SHA,
      sourceChanged: receipt?.plan?.sourceCommit !== env.GITHUB_SHA,
      registry: page, observations, registrationAuthorized: false };
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-inspection.json'), evidenceText(report));
    const message = `### PROD base read-only inspection\n\nReceipt: ${report.receiptPhase}; pending: ${report.pending ?? 'none'}.\nSource commit changed: ${report.sourceChanged ? 'yes' : 'no'}.\nRegistry groups: ${page.groups.length}; placements: ${page.placements.length}.\nNo journal or canister configuration writes. Review evidence before registration.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }
  if (receipt?.pending || (receipt && receipt.phase !== 'planned')) throw new Error('Existing receipt requires read-only reconciliation; no replay');
  stage = 'build current closed plan';
  const plan = buildBasePlan({ ids, principal, sourceCommit: env.GITHUB_SHA, page, observations,
    budgets: { maxClubs: env.BASE_MAX_CLUBS, minCycles: env.BASE_MIN_CYCLES, heapBudgetBytes: env.BASE_HEAP_BYTES } });
  if (action === 'plan') {
    const planned = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan };
    await journal.save(planned);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-plan.json'), evidenceText(planned));
    const message = `### PROD base group plan\n\nReviewed-plan hash: \`${planned.planHash}\`\n\n18 certified modules/controllers/subnets checked. Existing canisters only; base stays CLOSED.\nNo canister, identity, funding, DEV or database changes.\nPlan persisted on ${RECEIPTS_BRANCH}; inspect before registration.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }
  if (!receipt) throw new Error('Persisted reviewed plan required');
  stage = 'verify reviewed plan against current source and infrastructure';
  assertReviewedPlan(receipt.plan, env.BASE_PLAN_HASH, plan);
  const toGroup = g => ({ ...g, domains: g.domains.map(d => ({ ...d, canister: Principal.fromText(d.canister) })),
    photo_store: g.photo_store.map(p => Principal.fromText(p)), min_cycles: BigInt(g.min_cycles), heap_budget_bytes: BigInt(g.heap_budget_bytes),
    heap_bytes: BigInt(g.heap_bytes), cycles: BigInt(g.cycles), observed_at_ns: BigInt(g.observed_at_ns) });
  const toPlacement = p => ({ ...p, deployment_revision: BigInt(p.deployment_revision), primary_subnet: Principal.fromText(p.primary_subnet),
    approved_subnets: p.approved_subnets.map(s => Principal.fromText(s)),
    domains: p.domains.map(d => ({ ...d, canister: Principal.fromText(d.canister), subnet: Principal.fromText(d.subnet) })) });
  const result = await registerClosedBase({ plan: receipt.plan, receipt, checkpoint: async r => {
    stage = `durable checkpoint: ${r.pending ?? r.phase}`;
    await journal.save(r);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-receipt.json'), evidenceText(r));
    stage = `after acknowledged checkpoint: ${r.pending ?? r.phase}`;
  }, readRegistry,
    registerGroup: async (g, r) => unwrap(await router.register_group(toGroup(g), r)),
    registerPlacement: async (p, r) => unwrap(await router.register_group_placement(toPlacement(p), r)) });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-base-result.json'), evidenceText(result));
  const message = 'PROD base inventory registered and independently read back CLOSED. Identity lifecycle, g2, routing approval and opening remain separate. No funding, deployments, DEV or database changes.';
  console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  saveBaseFailure(process.env, error, stage);
  process.exitCode = 1;
});