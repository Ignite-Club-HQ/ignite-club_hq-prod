// Read-only PROD routing-gate review: group registry, placement, health,
// lifecycle wiring and routing-approval evidence, nothing else. There is no
// setter, no approval recording, no opening, no funding and no DEV access here.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText, internalReason, failureReason, VARIANT_CONFIG_READERS } from './prod-connection-check-policy.mjs';
import { assertRoutingGateContext, reviewRoutingGate, routingGateSummary, gateFailureReason, expectedServices, readFuelBalance } from './prod-routing-gate-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hex = bytes => Buffer.from(bytes ?? []).toString('hex');

// Decoded replies hold Principals and bigints; the review works on plain text
// so evidence stays JSON-safe and comparisons never depend on object identity.
const plain = value => {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toText === 'function') return value.toText();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
};

// Read-only management subset: status, cycles, controllers and environment.
function managementReader(IDL) {
  return () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), cycles: IDL.Nat,
      settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), environment_variables: IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text })) }) })], []),
  });
}

async function main() {
  const env = process.env;
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor, CanisterStatus } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  assertRoutingGateContext(ids, env, principal);
  console.log(`Signing as ${principal}`);

  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const publicAgent = await HttpAgent.create({ host: 'https://icp-api.io' });
  const fuel = id => Actor.createActor(() => IDL.Service({ cycles_balance:
    IDL.Func([], [IDL.Nat], ['query']) }), { agent: publicAgent, canisterId: id });
  const Pairs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
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
  const RoutingApproval = IDL.Record({ configuration_revision: IDL.Nat64, removal_checked_at_ms: IDL.Nat64,
    approved_configuration_sha256: IDL.Text, target_alias: IDL.Text, removal_wiring_group_ids: IDL.Vec(IDL.Text), evidence_sha256: IDL.Text });
  const unwrap = r => { if (!r || 'Err' in r) throw new Error('Infrastructure reader refused'); return r.Ok; };

  const router = Actor.createActor(() => IDL.Service({
    read_group_registry_page: IDL.Func([IDL.Text, IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Text), IDL.Nat32], [Result(RegistryPage)], []),
    read_routing_approval: IDL.Func([IDL.Text], [Result(IDL.Opt(RoutingApproval))], []),
  }), { agent, canisterId: ids.shard_router });
  const page = plain(unwrap(await router.read_group_registry_page('mainnet', [], [], 64)));
  const rawApproval = unwrap(await router.read_routing_approval('mainnet'));
  const approval = Array.isArray(rawApproval) && rawApproval.length ? plain(rawApproval[0]) : null;

  const mgmt = id => Actor.createActor(managementReader(IDL), { agent, canisterId: Principal.fromText('aaaaa-aa'), effectiveCanisterId: Principal.fromText(id) });
  const heap = id => Actor.createActor(() => IDL.Service({ memory_stats: IDL.Func([],
    [IDL.Record({ heap_bytes: IDL.Nat, memory_bytes: IDL.Nat, stable_bytes: IDL.Nat })], ['query']) }), { agent, canisterId: id });
  const config = (id, variant) => Actor.createActor(() => IDL.Service({ read_group_opening_configuration:
    IDL.Func([], [variant ? Result(Pairs) : Pairs], []) }), { agent, canisterId: id });
  const readConfig = async (id, variant) => {
    try {
      const value = await config(id, variant).read_group_opening_configuration();
      return plain(variant ? value?.Ok ?? null : value);
    } catch { return null; }
  };

  const services = [];
  for (const group of Array.isArray(page.groups) ? page.groups : []) {
    const placement = (Array.isArray(page.placements) ? page.placements : []).find(p => p.group_id === group.id);
    for (const item of expectedServices(group, placement)) {
      let running = false, controllers = [], cycles, environment = [];
      try {
        const status = await mgmt(item.id).canister_status({ canister_id: Principal.fromText(item.id) });
        running = !!status.status && 'running' in status.status;
        controllers = (status.settings?.controllers ?? []).map(p => p.toText());
        environment = status.settings?.environment_variables ?? [];
      } catch { /* unreadable service: the review reports it, never guesses it */ }
      const balance = await readFuelBalance(() => fuel(item.id).cycles_balance());
      cycles = balance.cycles;
      let subnet, moduleHash, heapBytes;
      try {
        const certified = await CanisterStatus.request({ agent, canisterId: Principal.fromText(item.id), paths: ['subnet', 'module_hash'] });
        subnet = certified.get('subnet')?.subnetId;
        const module = certified.get('module_hash');
        moduleHash = typeof module === 'string' ? module : hex(module ?? []);
      } catch { /* certified read unavailable: reported as a gap */ }
      try { heapBytes = (await heap(item.id).memory_stats()).heap_bytes.toString(); } catch { /* reported as a gap */ }
      services.push({ group: group.id, name: item.name, id: item.id, running, controllers, cycles, environment,
        balanceSource: 'anonymous cycles_balance query', subnet, moduleHash, heapBytes,
        configuration: await readConfig(item.id, VARIANT_CONFIG_READERS.includes(item.name)) });
    }
  }
  const routerConfig = await readConfig(ids.shard_router, true);
  const identityConfig = await readConfig(ids.identity_access, true);

  const review = reviewRoutingGate({ ids, principal, pushWorker: env.PROD_ICP_PUSH_WORKER_PRINCIPAL ?? env.PUSH_WORKER_PRINCIPAL,
    page, approval, services, routerConfig, identityConfig, checkedAt: new Date().toISOString() });
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-routing-gate.json'), evidenceText(review));
  const lines = routingGateSummary(review).split('\n');
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (!review.gateComplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const reason = typeof error?.code === 'string' && error.path ? `${error.code} ${path.basename(error.path)}`
      : internalReason(error) || (/^(Connection check requires|Unsupported governor key type|PROD governor|PROD must not|Governor principal|Repository variable|Evidence timestamp required|Only read-only check)/.test(String(error?.message))
        ? String(error.message).slice(0, 200) : gateFailureReason(error) || failureReason(error?.stderr ?? ''));
    console.error(`PROD routing gate stopped before finishing: ${reason}. No configuration changes were attempted.`);
    process.exitCode = 1;
  });
}
