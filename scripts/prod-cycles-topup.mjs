// Read-only PROD cycles top-up planner: reads the group registry, every group
// service's anonymous cycles balance and the signing account's cycles-ledger
// balance, then prints the exact per-canister top-up plan. There is no
// deposit, no funding order, no setter and no DEV access here.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText, internalReason, failureReason } from './prod-connection-check-policy.mjs';
import { expectedServices, readFuelBalance } from './prod-routing-gate-policy.mjs';
import { assertTopupContext, planCyclesTopup, topupSummary } from './prod-cycles-topup-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';

const plain = value => {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toText === 'function') return value.toText();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
};

async function main() {
  const env = process.env;
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  assertTopupContext(ids, env, principal);
  console.log(`Signing as ${principal}`);

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

  const services = [];
  for (const group of Array.isArray(page.groups) ? page.groups : []) {
    const placement = (Array.isArray(page.placements) ? page.placements : []).find(p => p.group_id === group.id);
    for (const item of expectedServices(group, placement)) {
      const balance = await readFuelBalance(() => fuel(item.id).cycles_balance());
      services.push({ group: group.id, name: item.name, id: item.id, cycles: balance.cycles, balanceRead: balance.balanceRead });
    }
  }

  const ledger = Actor.createActor(() => IDL.Service({ icrc1_balance_of:
    IDL.Func([IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })], [IDL.Nat], ['query']) }),
    { agent: publicAgent, canisterId: CYCLES_LEDGER });
  const account = await readFuelBalance(() => ledger.icrc1_balance_of({ owner: Principal.fromText(principal), subaccount: [] }));

  const plan = planCyclesTopup({ page, services, signingAccount: { balance: account.cycles, balanceRead: account.balanceRead },
    reserveCycles: env.TOPUP_RESERVE_CYCLES ?? '0', checkedAt: new Date().toISOString() });
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-cycles-topup.json'), evidenceText(plan));
  const lines = topupSummary(plan).split('\n');
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const reason = typeof error?.code === 'string' && error.path ? `${error.code} ${path.basename(error.path)}`
      : internalReason(error) || (/^(Connection check requires|Unsupported governor key type|PROD governor|PROD must not|Governor principal|Repository variable|Evidence timestamp required|Only read-only|Reserve must|No group|Registry exceeds|A bounded consensus|Group .* does not)/.test(String(error?.message))
        ? String(error.message).slice(0, 200) : failureReason(error?.stderr ?? ''));
    console.error(`PROD cycles top-up planning stopped before finishing: ${reason}. No deposit or funding order was attempted.`);
    process.exitCode = 1;
  });
}
