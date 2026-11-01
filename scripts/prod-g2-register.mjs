// Registers the already-created PROD g2 CLOSED in the live router, then reads
// the registry back. Nothing here opens a group, admits a club, funds, deploys,
// or touches DEV: the only writes are register_group/register_group_placement
// for one reviewed, closed, independent inventory.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText } from './prod-connection-check-policy.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { G2_RECEIPT_PATH } from './prod-g2-create-policy.mjs';
import {
  assertG2RegistrationContext, buildG2RegistrationPlan, assertReviewedG2RegistrationPlan,
  registerClosedG2, reconcileClosedG2Readback, G2_REGISTRATION_RECEIPT_PATH,
} from './prod-g2-register-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unwrap = r => { if ('Err' in r) throw new Error('Infrastructure operation refused; inspect signed readback, never replay'); return r.Ok; };

// Only locally defined labels are public; never emit arbitrary agent/API errors.
export function g2RegistrationFailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Live inventory, modules, controller, subnet or registry revision changed; re-plan',
    'Reviewed plan hash required (64 lowercase hex characters)',
    'Reviewed plan hash does not match the saved g2 registration receipt',
    'Closed-only plan required',
    'Confirmed closed base receipt required',
    'Confirmed closed g2 creation receipt required',
    'Complete independent g2 inventory required',
    'g2 must not reuse an existing PROD base canister',
    'g2 data canisters must be independent of base',
    'Every g2 service must hold its reviewed module',
    'Every g2 wiring operation must be complete',
    'Complete base-only registry required; an existing g2 needs separate review',
    'Live closed base configuration differs from reviewed receipt',
    'Registry revision predates confirmed base',
    'Exact single-subnet PROD placement required',
    'Complete certified g2 evidence required',
    'Router budgets out of bounds',
    'Reviewed closed g2 registration receipt required',
    'Unresolved intent; reconcile without replay',
    'Unexpected registration revision; stop without replay',
    'Unexpected placement revision; stop without replay',
    'Closed g2 registry readback mismatch; stop without replay',
    'Pending readback receipt for the reviewed plan required',
    'Reviewed base plan required for g2 readback',
    'Persisted reviewed plan required',
    'Existing receipt requires read-only reconciliation; no replay',
    'Journal acknowledgement mismatch; stop without replay',
    'Journal readback failed; stop without replay',
    'Infrastructure operation refused; inspect signed readback, never replay',
  ];
  if (known.includes(message)) return message;
  if (/^Certified g2 evidence mismatch: [a-z_]+$/.test(message)) return message;
  if (/^GitHub journal (GET|POST|PUT) failed \([0-9]{3}\); stop without replay$/.test(message)) return message;
  return 'Unclassified failure; inspect the saved stage and receipt without retrying registration';
}
let stage = 'startup';
export function saveG2RegistrationFailure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: g2RegistrationFailureReason(error), retryAuthorized: false };
  const message = `### PROD g2 registration stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry registration until the durable receipt is reviewed.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

async function main() {
  const env = process.env, action = env.G2R_ACTION;
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
  assertG2RegistrationContext(ids, env, principal, action);

  stage = 'certified infrastructure readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const contract = groupContract(IDL);
  const router = Actor.createActor(action === 'register-closed' ? contract.closedRegistrar : contract.reader,
    { agent, canisterId: ids.shard_router });
  const readRegistry = async revision => JSON.parse(evidenceText(
    unwrap(await router.read_group_registry_page('mainnet', revision === undefined ? [] : [BigInt(revision)], [], 64))));
  const page = await readRegistry();

  stage = 'load durable receipts';
  const baseJournal = githubJournal(env);
  const creationJournal = githubJournal(env, fetch, { path: G2_RECEIPT_PATH, label: 'g2 creation' });
  const journal = githubJournal(env, fetch, { path: G2_REGISTRATION_RECEIPT_PATH, label: 'g2 registration' });
  const baseReceipt = await baseJournal.load({ readOnly: true });
  const creationReceipt = await creationJournal.load({ readOnly: true });
  const receipt = await journal.load({ readOnly: action === 'inspect' });
  if (receipt) writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-receipt.json'), evidenceText(receipt));
  if (action === 'inspect') {
    const report = { receiptPhase: receipt?.phase ?? 'missing', pending: receipt?.pending ?? null,
      basePhase: baseReceipt?.phase ?? 'missing', creationPhase: creationReceipt?.phase ?? 'missing',
      registryGroups: page.groups.length, registryPlacements: page.placements.length,
      savedSourceCommit: receipt?.plan?.sourceCommit ?? null, currentSourceCommit: env.GITHUB_SHA,
      sourceChanged: receipt?.plan?.sourceCommit !== env.GITHUB_SHA, registrationAuthorized: false };
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-inspection.json'), evidenceText(report));
    const message = `### PROD g2 registration read-only inspection\n\nRegistration receipt: ${report.receiptPhase}; pending: ${report.pending ?? 'none'}.\nBase receipt: ${report.basePhase}; creation receipt: ${report.creationPhase}.\nRegistry groups: ${report.registryGroups}; placements: ${report.registryPlacements}.\nSource commit changed: ${report.sourceChanged ? 'yes' : 'no'}.\nNo journal or router writes. Review evidence before registration.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }
  if (action === 'reconcile-readback') {
    stage = 'reconcile pending readback (no registration calls)';
    const result = await reconcileClosedG2Readback({ receipt, expectedHash: env.G2R_PLAN_HASH, readRegistry, checkpoint: async r => {
      stage = 'durable checkpoint: registered-closed';
      await journal.save(r);
      writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-receipt.json'), evidenceText(r));
    } });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-result.json'), evidenceText(result));
    const message = `### PROD g2 registration confirmed\n\nLive router read back revision ${result.revision}: closed "base" plus closed "g2", both exactly matching the reviewed plans. Group stays CLOSED.\nNo registration calls were repeated. Identity lifecycle, routing approval and opening remain separate.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }
  if (receipt?.pending || (receipt && receipt.phase !== 'planned')) throw new Error('Existing receipt requires read-only reconciliation; no replay');

  stage = 'certify created g2 services';
  const created = creationReceipt?.canisters ?? {};
  const observations = [];
  for (const name of Object.keys(created).sort()) {
    const s = await CanisterStatus.request({ agent, canisterId: Principal.fromText(created[name]), paths: ['controllers', 'module_hash', 'subnet'] });
    const module = s.get('module_hash');
    observations.push({ name, id: created[name],
      moduleHash: typeof module === 'string' ? module : Buffer.from(module ?? []).toString('hex'),
      controllers: (s.get('controllers') ?? []).map(p => p.toText()), subnet: s.get('subnet')?.subnetId });
  }

  stage = 'build current closed registration plan';
  const plan = { ...buildG2RegistrationPlan({ ids, env, principal, baseReceipt, g2Receipt: creationReceipt, page,
    observations, budgets: { maxClubs: env.G2R_MAX_CLUBS, minCycles: env.G2R_MIN_CYCLES, heapBudgetBytes: env.G2R_HEAP_BYTES },
    checkedAt: new Date().toISOString() }), basePlan: baseReceipt.plan };
  if (action === 'plan') {
    const planned = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan };
    await journal.save(planned);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-plan.json'), evidenceText(planned));
    const message = `### PROD g2 closed registration plan\n\nReviewed-plan hash: \`${planned.planHash}\`\n\nOne NEW closed group "g2": 13 independent services plus the shared workload identity, on one approved subnet. The base group must still read exactly as its reviewed receipt.\nNo opening, admission, funding, DEV or database changes.\nPlan persisted; inspect before registration.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }
  if (!receipt) throw new Error('Persisted reviewed plan required');
  stage = 'verify reviewed plan against current source and infrastructure';
  assertReviewedG2RegistrationPlan(receipt.plan, env.G2R_PLAN_HASH, plan);
  const toGroup = g => ({ ...g, domains: g.domains.map(d => ({ ...d, canister: Principal.fromText(d.canister) })),
    photo_store: g.photo_store.map(p => Principal.fromText(p)), min_cycles: BigInt(g.min_cycles),
    heap_budget_bytes: BigInt(g.heap_budget_bytes), heap_bytes: BigInt(g.heap_bytes), cycles: BigInt(g.cycles),
    observed_at_ns: BigInt(g.observed_at_ns) });
  const toPlacement = p => ({ ...p, deployment_revision: BigInt(p.deployment_revision),
    primary_subnet: Principal.fromText(p.primary_subnet), approved_subnets: p.approved_subnets.map(s => Principal.fromText(s)),
    domains: p.domains.map(d => ({ ...d, canister: Principal.fromText(d.canister), subnet: Principal.fromText(d.subnet) })) });
  const result = await registerClosedG2({ plan: receipt.plan, receipt, checkpoint: async r => {
    stage = `durable checkpoint: ${r.pending ?? r.phase}`;
    await journal.save(r);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-receipt.json'), evidenceText(r));
    stage = `after acknowledged checkpoint: ${r.pending ?? r.phase}`;
  }, readRegistry,
    registerGroup: async (g, r) => unwrap(await router.register_group(toGroup(g), r)),
    registerPlacement: async (p, r) => unwrap(await router.register_group_placement(toPlacement(p), r)) });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-registration-result.json'), evidenceText(result));
  const message = 'PROD g2 registered and independently read back CLOSED. Identity lifecycle, routing approval and opening remain separate. No funding, deployments, DEV or database changes.';
  console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  saveG2RegistrationFailure(process.env, error, stage);
  process.exitCode = 1;
});
