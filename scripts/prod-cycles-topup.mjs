// PROD cycles top-up runner. Actions:
//   plan          read-only balances + durable reviewed plan receipt
//   topup-closed  checkpointed, confirmation-gated distribution of exactly the
//                 reviewed amounts through the cycles ledger (idempotent)
// No funding order, no configuration change, no registration, no opening and
// no DEV access in either action. Groups stay CLOSED throughout.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText, internalReason, failureReason } from './prod-connection-check-policy.mjs';
import { expectedServices, readFuelBalance } from './prod-routing-gate-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { topupService, cyclesService } from './prod-g2-idl.mjs';
import { assertTopupContext, planCyclesTopup, topupSummary, assertReviewedTopupPlan,
  runCyclesTopup, resumeTopupIntent, topupResultSummary, TOPUP_RECEIPT_PATH } from './prod-cycles-topup-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';

let stage = 'startup';
const KNOWN_FAILURES = [
  'Only read-only plan or confirmation-gated topup-closed supported',
  'Reviewed plan hash required (64 lowercase hex characters)',
  'Reviewed plan hash does not match the saved top-up receipt',
  'Live inventory, targets or amounts changed; re-plan',
  'Reviewed top-up plan receipt required',
  'Top-up already completed; this tool never replays a finished run',
  'Signing account balance unreadable; stop without replay',
  'Signing account balance below the reviewed top-up requirement; fund before topping up',
  'Unresolved intent; reconcile without replay',
  'Unknown pending intent; reconcile by hand',
  'Deposit intent inconsistent with recorded deposits; reconcile by hand',
  'Deposit intent older than the ledger dedup window; reconcile by hand',
  'Ledger deposit refused; inspect signed readback, never replay',
  'Ledger withdraw to canister rejected (refunded minus fee); stop without replay',
  'Journal acknowledgement mismatch; stop without replay',
  'Journal readback failed; stop without replay',
];
function topupFailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  if (KNOWN_FAILURES.includes(message)) return message;
  if (new RegExp(`^Exact confirmation required: TOP UP PROD CANISTERS$`).test(message)) return message;
  if (/^Live balance unreadable for [\w-]+\/[\w-]+; stop without replay$/.test(message)) return message;
  if (/^[\w-]+\/[\w-]+ deposit did not land; stop without replay$/.test(message)) return message;
  if (/^GitHub journal (GET|POST|PUT) failed \([0-9]{3}\); stop without replay$/.test(message)) return message;
  if (/^ENOENT: no such file or directory/.test(message)) return `Missing file: ${message.slice(0, 200)}`;
  if (error instanceof Error) return `Unclassified failure (${error.name}: ${message.replace(/[A-Za-z0-9+/=]{48,}/g, '[redacted]').slice(0, 200)}); inspect without retrying`;
  return 'Unclassified failure; inspect the saved stage and receipt without retrying';
}
function saveTopupFailure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: topupFailureReason(error), retryAuthorized: false };
  const message = `### PROD cycles top-up stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry until the durable receipt is reviewed. No partial deposit is ever replayed blindly: the ledger dedup timestamp in the receipt makes a resumed deposit land at most once.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

const plain = value => {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toText === 'function') return value.toText();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
};

async function main() {
  const env = process.env;
  const action = env.TOPUP_ACTION ?? 'plan';
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  stage = 'context and signing identity';
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  assertTopupContext(ids, env, principal, action);
  console.log(`Signing as ${principal}`);

  stage = 'certified registry and balance readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const publicAgent = await HttpAgent.create({ host: 'https://icp-api.io' });
  const fuel = id => Actor.createActor(() => IDL.Service({ cycles_balance:
    IDL.Func([], [IDL.Nat], ['query']) }), { agent: publicAgent, canisterId: id });
  const Result = ok => IDL.Variant({ Ok: ok, Err: IDL.Text });
  const DomainCanister = IDL.Record({ domain: IDL.Text, canister: IDL.Principal });
  const ShardGroup = IDL.Record({ id: IDL.Text, max_clubs: IDL.Nat32, observed_at_ns: IDL.Nat64, accepting: IDL.Bool,
    photo_store: IDL.Opt(IDL.Principal), heap_budget_bytes: IDL.Nat64, cycles: IDL.Nat64, assigned_clubs: IDL.Nat32,
    domains: IDL.Vec(DomainCanister), target_alias: IDL.Text, min_cycles: IDL.Nat64, heap_bytes: IDL.Nat64 });
  const Placement = IDL.Record({ group_id: IDL.Text, deployment_id: IDL.Text, deployment_revision: IDL.Nat64,
    host: IDL.Text, network_kind: IDL.Text, primary_subnet: IDL.Principal,
    approved_subnets: IDL.Vec(IDL.Principal), additional_subnets_enabled: IDL.Bool,
    domains: IDL.Vec(IDL.Record({ domain: IDL.Text, canister: IDL.Principal, subnet: IDL.Principal })) });
  const RegistryPage = IDL.Record({ groups: IDL.Vec(ShardGroup), placements: IDL.Vec(Placement),
    revision: IDL.Nat64, configuration_revision: IDL.Opt(IDL.Nat64), next_cursor: IDL.Opt(IDL.Text) });
  const unwrap = r => { if (!r || 'Err' in r) throw new Error('Infrastructure reader refused'); return r.Ok; };

  const router = Actor.createActor(() => IDL.Service({
    read_group_registry_page: IDL.Func([IDL.Text, IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Text), IDL.Nat32], [Result(RegistryPage)], []),
  }), { agent, canisterId: ids.shard_router });
  const page = plain(unwrap(await router.read_group_registry_page('mainnet', [], [], 64)));

  const ledger = Actor.createActor(topupService(IDL), { agent, canisterId: CYCLES_LEDGER });
  const services = [];
  for (const group of Array.isArray(page.groups) ? page.groups : []) {
    const placement = (Array.isArray(page.placements) ? page.placements : []).find(p => p.group_id === group.id);
    for (const item of expectedServices(group, placement)) {
      const balance = await readFuelBalance(() => fuel(item.id).cycles_balance());
      // Read-only: cycles sitting in the canister's OWN cycles-ledger account
      // (e.g. from the earlier misdirected icrc1_transfer run). Not fuel.
      const held = await readFuelBalance(() => ledger.icrc1_balance_of({ owner: Principal.fromText(item.id), subaccount: [] }));
      services.push({ group: group.id, name: item.name, id: item.id, cycles: balance.cycles, balanceRead: balance.balanceRead,
        ledgerHeld: held.cycles });
    }
  }

  const account = await readFuelBalance(() => ledger.icrc1_balance_of({ owner: Principal.fromText(principal), subaccount: [] }));

  const plan = planCyclesTopup({ page, services, signingAccount: { balance: account.cycles, balanceRead: account.balanceRead },
    reserveCycles: env.TOPUP_RESERVE_CYCLES ?? '0', checkedAt: new Date().toISOString() });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup.json'), evidenceText(plan));

  stage = 'load durable receipt';
  const journal = githubJournal(env, fetch, { path: TOPUP_RECEIPT_PATH, label: 'cycles top-up' });
  const receipt = await journal.load({ readOnly: action === 'plan' });
  if (receipt) writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup-receipt.json'), evidenceText(receipt));

  if (action === 'plan') {
    if (receipt?.pending || (receipt && !['planned', 'fueled'].includes(receipt.phase)))
      throw new Error('Unresolved intent; reconcile without replay');
    if (receipt?.phase === 'fueled')
      throw new Error('Top-up already completed; this tool never replays a finished run');
    const planned = { version: 1, phase: 'planned', pending: null, planHash: plan.planHash, plan };
    await journal.save(planned);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup-receipt.json'), evidenceText(planned));
    const lines = topupSummary(plan).split('\n');
    console.log(lines.join('\n'));
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    return;
  }

  // topup-closed
  if (!receipt) throw new Error('Reviewed top-up plan receipt required');
  stage = 'verify reviewed plan against current inventory and balances';
  assertReviewedTopupPlan(receipt.plan, env.TOPUP_PLAN_HASH, plan);

  const pid = id => Principal.fromText(id);
  const calls = {
    cyclesOf: async id => Actor.createActor(cyclesService(IDL), { agent, canisterId: pid(id) }).cycles_balance(),
    accountBalance: () => ledger.icrc1_balance_of({ owner: pid(principal), subaccount: [] }),
    async deposit({ to, amount, createdAtNs }) {
      // Real canister top-up: the ledger's `withdraw` moves cycles from the
      // signing account into the canister's own cycle balance. (A plain
      // icrc1_transfer to the canister principal does NOT fuel it.)
      const r = await ledger.withdraw({ amount, from_subaccount: [], to: pid(to), created_at_time: [createdAtNs] });
      if ('Ok' in r) return { blockIndex: r.Ok.toString() };
      if ('Duplicate' in r.Err) return { duplicate: true, blockIndex: r.Err.Duplicate.duplicate_of.toString() };
      if ('FailedToWithdraw' in r.Err)
        throw new Error('Ledger withdraw to canister rejected (refunded minus fee); stop without replay');
      throw new Error('Ledger deposit refused; inspect signed readback, never replay');
    },
  };

  const checkpoint = async r => {
    stage = `durable checkpoint: ${r.pending ? `${r.pending.kind} ${r.pending.service ?? ''}` : r.phase}`;
    await journal.save(r);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup-receipt.json'), evidenceText(r));
  };

  stage = 'resume unresolved intent';
  let current = receipt;
  while (current.pending) current = await resumeTopupIntent({ receipt: current, checkpoint, calls, nowNs: () => BigInt(Date.now()) * 1_000_000n });

  stage = 'closed top-up';
  const result = await runCyclesTopup({ plan: receipt.plan, receipt: current, checkpoint, calls, nowNs: () => BigInt(Date.now()) * 1_000_000n });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup-result.json'), evidenceText(result));
  const message = topupResultSummary(result);
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    if ((process.env.TOPUP_ACTION ?? 'plan') === 'plan') {
      const reason = typeof error?.code === 'string' && error.path ? `${error.code} ${path.basename(error.path)}`
        : internalReason(error) || (/^(Connection check requires|Unsupported governor key type|PROD governor|PROD must not|Governor principal|Repository variable|Evidence timestamp required|Only read-only|Reserve must|No group|Registry exceeds|A bounded consensus|Group .* does not|Unresolved intent|Top-up already completed|Live repository journal|GitHub journal (GET|POST|PUT) failed \([0-9]{3}\)|Journal acknowledgement mismatch|Journal readback failed|Receipt branch acknowledgement mismatch|Unsupported receipt encoding)/.test(String(error?.message))
          ? String(error.message).slice(0, 200) : failureReason(error?.stderr ?? ''));
      console.error(`PROD cycles top-up planning stopped before finishing: ${reason}. No deposit or funding order was attempted.`);
    } else {
      saveTopupFailure(process.env, error, stage);
    }
    process.exitCode = 1;
  });
}
