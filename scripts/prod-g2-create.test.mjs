import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { assertG2Context, buildG2CreationPlan, assertReviewedG2Plan, g2ConfigurationBinding,
  runG2Creation, resumeG2Intent, g2PlanSummary, G2_SERVICES, G2_CREATE_CONFIRMATION,
  G2_CYCLES_PER_CANISTER, G2_LEDGER_FEE, G2_PHOTO_STORE_BYTES, CONFIGURATION_RECIPE } from './prod-g2-create-policy.mjs';
import { G2_SETTERS, setterService } from './prod-g2-idl.mjs';

const GOVERNOR = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const WORKER = '2lxvg-xb46k-6vng7-ixvcu-mq6uw-yom3g-hm5x5-u45yn-yj2co-ksmrb-fqe';
const SUBNET = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const HASHES = Object.fromEntries(Object.keys(PROD_CHECK_IDS).map((n, i) => [n, String(i).padStart(64, 'a')]));
const NEW_ID = i => `new${String(i).padStart(2, '0')}-aaaaa-aaaai-ayf${String(i).padStart(2, '0')}-cai`;

const env = (over = {}) => ({ GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod',
  GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', GITHUB_SHA: 'b'.repeat(40),
  PROD_GOVERNOR_PRINCIPAL: GOVERNOR, ...over });

const baseGroup = () => ({ id: 'base', target_alias: 'mainnet', accepting: false, max_clubs: 100, assigned_clubs: 0,
  heap_budget_bytes: '3221225472', heap_bytes: '0', min_cycles: '1000000000000', cycles: '0', observed_at_ns: '0',
  domains: [...GROUP_DOMAINS, 'secret_workload_identity'].map(domain => ({ domain, canister: PROD_CHECK_IDS[domain] })),
  photo_store: [PROD_CHECK_IDS.media_blob_store] });
const basePlacement = () => ({ group_id: 'base', deployment_id: 'prod', deployment_revision: '1',
  host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: SUBNET, approved_subnets: [SUBNET],
  additional_subnets_enabled: false,
  domains: [...GROUP_DOMAINS, 'secret_workload_identity'].map(domain => ({ domain, canister: PROD_CHECK_IDS[domain], subnet: SUBNET })) });
const baseReceipt = () => {
  const plan = { version: 1, sourceCommit: 'a'.repeat(40), principal: GOVERNOR, expectedRevision: '0',
    configurationRevision: '1', group: baseGroup(), placement: basePlacement(),
    openingAuthorized: false, lifecycleReleaseAuthorized: false };
  return { version: 1, phase: 'registered-closed', pending: null, planHash: hashPlan(plan), plan,
    groupRevision: '1', placementRevision: '2' };
};
const page = () => ({ groups: [baseGroup()], placements: [basePlacement()], revision: '2', configuration_revision: ['2'], next_cursor: [] });
const observations = () => Object.keys(PROD_CHECK_IDS).sort().map(name => ({ name, id: PROD_CHECK_IDS[name],
  moduleHash: HASHES[name], controllers: [GOVERNOR], subnet: SUBNET }));
const wasmHashes = () => Object.fromEntries(G2_SERVICES.map(n => [n, HASHES[n]]));
const BALANCE = (30n * 1_000_000_000_000n).toString();

const planInput = (over = {}) => ({ ids: { ...PROD_CHECK_IDS }, env: env(), principal: GOVERNOR,
  baseReceipt: baseReceipt(), page: page(), observations: observations(), wasmHashes: wasmHashes(),
  pushWorker: WORKER, balance: BALANCE, checkedAt: '2026-11-01T06:00:00.000Z', ...over });
const plan = (over = {}) => buildG2CreationPlan(planInput(over));

test('context requires live repo prod branch, governor and known actions', () => {
  assert.throws(() => assertG2Context({ ...PROD_CHECK_IDS }, env({ GITHUB_REF: 'refs/heads/main' }), GOVERNOR, 'plan'), /prod branch/);
  assert.throws(() => assertG2Context({ ...PROD_CHECK_IDS }, env(), GOVERNOR, 'open'), /Only plan, inspect or create-closed/);
  assert.throws(() => assertG2Context({ ...PROD_CHECK_IDS }, env(), GOVERNOR, 'create-closed'), new RegExp(G2_CREATE_CONFIRMATION));
  assert.throws(() => assertG2Context({ ...PROD_CHECK_IDS }, env({ PROD_GOVERNOR_PRINCIPAL: WORKER }), GOVERNOR, 'plan'), /governor mismatch/);
  assertG2Context({ ...PROD_CHECK_IDS }, env({ CONFIRMATION: ` ${G2_CREATE_CONFIRMATION}\n` }), GOVERNOR, 'create-closed');
});

test('plan requires confirmed closed base and base-only registry', () => {
  assert.throws(() => plan({ baseReceipt: { ...baseReceipt(), phase: 'planned' } }), /Confirmed closed base receipt/);
  assert.throws(() => plan({ page: { ...page(), groups: [...page().groups, { ...baseGroup(), id: 'g2' }] } }), /base-only registry/);
  const drifted = page(); drifted.groups[0] = { ...drifted.groups[0], max_clubs: 50 };
  assert.throws(() => plan({ page: drifted }), /differs from reviewed receipt/);
});

test('plan requires certified observations and matching built modules', () => {
  assert.throws(() => plan({ observations: observations().slice(1) }), /Complete certified PROD infrastructure evidence/);
  const bad = observations(); bad[0] = { ...bad[0], controllers: [WORKER] };
  assert.throws(() => plan({ observations: bad }), /Certified PROD infrastructure mismatch/);
  assert.throws(() => plan({ wasmHashes: { ...wasmHashes(), club_domain: 'f'.repeat(64) } }),
    /Built club_domain module differs from the certified base module/);
  assert.throws(() => plan({ wasmHashes: { ...wasmHashes(), timer_jobs: 'xyz' } }), /Missing built module hash for timer_jobs/);
});

test('plan requires a valid push worker and sufficient balance', () => {
  assert.throws(() => plan({ pushWorker: PROD_CHECK_IDS.club_domain }), /push worker/);
  assert.throws(() => plan({ pushWorker: 'aaaaa-aa' }), /push worker/);
  const short = (13n * (G2_CYCLES_PER_CANISTER + G2_LEDGER_FEE) - 1n).toString();
  assert.throws(() => plan({ balance: short }), /balance below the estimated creation requirement/);
  const p = plan();
  assert.equal(p.services.length, 13);
  assert.equal(p.registrationAuthorized, false);
  assert.equal(p.openingAuthorized, false);
  assert.equal(p.primarySubnet, SUBNET);
  assert.equal(p.configurationRecipe.length, CONFIGURATION_RECIPE.length);
  assert.match(g2PlanSummary(p), /CLOSED/);
});

test('reviewed plan hash must match saved receipt and current evidence', () => {
  const p = plan();
  const hash = hashPlan(p);
  assert.throws(() => assertReviewedG2Plan(p, 'nope', p), /64 lowercase hex/);
  assert.throws(() => assertReviewedG2Plan(p, 'c'.repeat(64), p), /does not match the saved g2 receipt/);
  // A later run rebuilds the plan with a fresh timestamp and live balance; those
  // must not force a re-plan, but real drift still must.
  assertReviewedG2Plan(p, hash, plan({ checkedAt: '2026-11-01T07:00:00.000Z' }));
  assertReviewedG2Plan(p, hash, plan({ balance: '22000000000000' }));
  assert.throws(() => assertReviewedG2Plan(p, hash, plan({ sourceCommit: '0'.repeat(40) })), /re-plan/);
  assert.throws(() => assertReviewedG2Plan(p, hash, plan({ subnet: 'aaaaa-aa' })), /re-plan/);
  assertReviewedG2Plan(p, ` ${hash}\n`, p);
});

test('configuration binding resolves 34 operations and rejects bad inventories', () => {
  const p = plan();
  const canisters = Object.fromEntries(G2_SERVICES.map((n, i) => [n, NEW_ID(i)]));
  const ops = g2ConfigurationBinding(p, canisters);
  assert.equal(ops.length, CONFIGURATION_RECIPE.length);
  assert.equal(ops[0].name, 'media_blob_store.set_club_domain_canister');
  assert.deepEqual(ops[0].args, [canisters.club_domain]);
  const vaultStores = ops.find(o => o.name === 'vault_domain.set_vault_stores');
  assert.deepEqual(vaultStores.args, [[canisters.media_blob_store]]);
  const grants = ops.filter(o => o.method === 'grant_worker');
  assert.equal(grants.length, 2);
  assert.ok(grants.every(g => g.args[0] === WORKER));
  const identity = ops.find(o => o.name === 'notification_queue.set_identity_access_canister');
  assert.deepEqual(identity.args, [PROD_CHECK_IDS.identity_access]);
  const dup = { ...canisters, timer_jobs: canisters.club_domain };
  assert.throws(() => g2ConfigurationBinding(p, dup), /Duplicate g2 canister/);
  assert.throws(() => g2ConfigurationBinding(plan({ pushWorker: canisters.club_domain }), canisters), /duplicated in group/);
});

/** Fake infrastructure for the state machine: ledger, management and setters. */
function fakeCalls(over = {}) {
  const state = { created: new Map(), installed: new Map(), configured: [], env: new Map(), balances: new Map(),
    stable: false, capacity: 0n, createCount: 0 };
  const calls = {
    wasm: name => new Uint8Array([...Buffer.from(name)]),
    initArg: () => new Uint8Array([1]),
    environment: name => name === 'pii_access_control' ? [{ name: 'VETKD_KEY_NAME', value: 'key_1' }]
      : name === 'media_blob_store' ? [{ name: 'GOVERNOR_PRINCIPAL', value: GOVERNOR }] : [],
    async createCanister({ createdAtNs, subnetId }) {
      state.createCount++;
      for (const [id, c] of state.created) if (c.createdAtNs === createdAtNs) return { duplicateOf: id };
      const id = NEW_ID(state.createCount - 1);
      state.created.set(id, { createdAtNs, subnetId });
      state.balances.set(id, G2_CYCLES_PER_CANISTER);
      return { canisterId: id };
    },
    subnetOf: async id => state.created.get(id)?.subnetId ?? SUBNET,
    async status(id) {
      return { controllers: [GOVERNOR], moduleHash: state.installed.get(id) ?? null, running: state.installed.has(id) };
    },
    setEnvironment: async (id, vars) => state.env.set(id, vars),
    async installChunked(id, wasm) { state.installed.set(id, HASHES_BY_WASM(wasm)); },
    cyclesOf: async id => state.balances.get(id) ?? 0n,
    configure: async (domain, id, method) => state.configured.push(`${domain}.${method}`),
    blobStableEnabled: async () => state.stable,
    blobEnableStable: async () => { state.stable = true; },
    blobSetCapacity: async (id, size) => { state.capacity = size; },
    blobCapacity: async () => state.capacity,
    ...over,
  };
  return { state, calls };
}
const HASHES_BY_WASM = wasm => {
  const name = Buffer.from(wasm).toString();
  return HASHES[name];
};

const plannedReceipt = p => ({ version: 1, phase: 'planned', pending: null, planHash: hashPlan(p), plan: p });
let clock = 1_762_000_000n * 1_000_000_000n;
const now = () => (clock += 1_000_000n);

test('creation runs create, install, configure, health and photo sizing, closed only', async () => {
  const p = plan();
  const { state, calls } = fakeCalls();
  const saved = [];
  const result = await runG2Creation({ plan: p, receipt: plannedReceipt(p),
    checkpoint: async r => saved.push(r), calls, nowNs: now });
  assert.equal(result.createdClosed, true);
  assert.equal(result.registrationAuthorized, false);
  assert.equal(state.created.size, 13);
  assert.equal(state.installed.size, 13);
  assert.equal(state.configured.length, CONFIGURATION_RECIPE.length);
  assert.equal(state.configured[0], 'media_blob_store.set_club_domain_canister');
  assert.equal(state.stable, true);
  assert.equal(state.capacity, G2_PHOTO_STORE_BYTES);
  const final = saved.at(-1);
  assert.equal(final.phase, 'sized');
  assert.equal(final.pending, null);
  // Every mutation was preceded by an acknowledged intent or phase checkpoint.
  assert.ok(saved.some(r => r.pending?.kind === 'create'));
  assert.ok(saved.some(r => r.pending?.kind === 'configure'));
});

test('creation refuses a module that differs from the reviewed plan', async () => {
  const p = plan();
  const { calls } = fakeCalls();
  calls.installChunked = async id => { throw new Error('never reached'); };
  calls.status = async () => ({ controllers: [GOVERNOR], moduleHash: 'f'.repeat(64), running: true });
  await assert.rejects(runG2Creation({ plan: p, receipt: plannedReceipt(p), checkpoint: async () => {}, calls, nowNs: now }),
    /holds a different module; refusing to overwrite/);
});

test('creation stops when a service lands on an unapproved subnet', async () => {
  const p = plan();
  const { calls } = fakeCalls();
  calls.subnetOf = async () => '2vxsx-fae';
  await assert.rejects(runG2Creation({ plan: p, receipt: plannedReceipt(p), checkpoint: async () => {}, calls, nowNs: now }),
    /landed on unapproved subnet; stop without replay/);
});

test('creation refuses to touch an existing PROD base canister', async () => {
  const p = plan();
  const { calls } = fakeCalls();
  calls.createCanister = async () => ({ canisterId: PROD_CHECK_IDS.club_domain });
  await assert.rejects(runG2Creation({ plan: p, receipt: plannedReceipt(p), checkpoint: async () => {}, calls, nowNs: now }),
    /Refusing existing PROD base canister/);
});

test('interrupted run resumes: duplicate create returns the same canister', async () => {
  const p = plan();
  const { state, calls } = fakeCalls();
  const saved = [];
  const checkpoint = async r => saved.push(r);
  // Simulate a crash after the first create intent was acknowledged and the call landed.
  const firstOp = now().toString();
  const crashed = { ...plannedReceipt(p), phase: 'creating', canisters: {}, observedSubnets: {},
    installedDomains: [], pending: { kind: 'create', domain: 'club_domain', operation: firstOp } };
  const resumed = await resumeG2Intent({ plan: p, receipt: crashed, checkpoint, calls, nowNs: now });
  assert.equal(resumed.pending, null);
  assert.ok(resumed.canisters.club_domain);
  // Re-running the same intent dedups to the same canister.
  const again = await calls.createCanister({ createdAtNs: BigInt(firstOp), subnetId: SUBNET });
  assert.equal(again.duplicateOf, resumed.canisters.club_domain);
});

test('stale create intent beyond the ledger dedup window stops for manual review', async () => {
  const p = plan();
  const { calls } = fakeCalls();
  const stale = { ...plannedReceipt(p), phase: 'creating', canisters: {},
    pending: { kind: 'create', domain: 'club_domain', operation: '1' } };
  await assert.rejects(resumeG2Intent({ plan: p, receipt: stale, checkpoint: async () => {}, calls, nowNs: now }),
    /dedup window; reconcile by hand/);
});

test('configuration resume skips completed operations and rejects receipt drift', async () => {
  const p = plan();
  const { state, calls } = fakeCalls();
  const canisters = Object.fromEntries(G2_SERVICES.map((n, i) => [n, NEW_ID(i)]));
  for (const [id] of Object.entries(canisters)) state.created.set(id, { subnetId: SUBNET });
  for (const [n, id] of Object.entries(canisters)) state.installed.set(id, HASHES[n]);
  const done = CONFIGURATION_RECIPE.slice(0, 10).map(([d, m]) => `${d}.${m}`);
  const bindingReceipt = { ...plannedReceipt(p), phase: 'installed', canisters,
    installedDomains: [...G2_SERVICES], observedSubnets: Object.fromEntries(G2_SERVICES.map(n => [n, SUBNET])),
    configuration: { binding: 'wrong', completed: done } };
  await assert.rejects(runG2Creation({ plan: p, receipt: bindingReceipt, checkpoint: async () => {}, calls, nowNs: now }),
    /Configuration binding changed/);
});

test('setter IDL subsets match the generated bindings', async (t) => {
  const bindingsRoot = new URL('../frontend/src/lab/bindings/', import.meta.url);
  if (!existsSync(bindingsRoot)) return t.skip('generated bindings only exist in the development layout');
  const require = createRequire(new URL('../frontend/package.json', import.meta.url));
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { pathToFileURL } = await import('node:url');
  for (const [service, methods] of Object.entries(G2_SETTERS)) {
    if (!Object.keys(methods).length) continue;
    const didPath = new URL(`${service}/declarations/${service}.did.js`, bindingsRoot);
    if (!existsSync(didPath)) return t.skip(`generated bindings for ${service} only exist in the development layout`);
    const { idlFactory } = await import(didPath.href);
    const real = idlFactory({ IDL });
    const subset = setterService(IDL, service)({ IDL });
    for (const method of Object.keys(methods)) {
      const realMethod = real._fields.find(f => f[0] === method);
      assert.ok(realMethod, `${service}.${method} missing from generated bindings`);
      const subsetMethod = subset._fields.find(f => f[0] === method);
      // Encode the same arguments through both IDLs; encodings must be identical.
      const args = subsetMethod[1].argTypes.map(t => {
        if (t === IDL.Principal) return Principal.fromText(GOVERNOR);
        if (t?.constructor?.name === 'VecClass') return [Principal.fromText(GOVERNOR)];
        if (t === IDL.Nat64) return 5n;
        return undefined;
      }).filter(a => a !== undefined);
      assert.equal(args.length, realMethod[1].argTypes.length, `${service}.${method} argument count drift`);
      const viaSubset = IDL.encode(subsetMethod[1].argTypes, args);
      const viaReal = IDL.encode(realMethod[1].argTypes, args);
      assert.deepEqual(Buffer.from(viaSubset), Buffer.from(viaReal), `${service}.${method} argument encoding drift`);
    }
  }
});

test('g2 workflow restores the signing key in the same step that uses it', async () => {
  const { readFileSync } = await import('node:fs');
  const wf = readFileSync(new URL('../.github/workflows/create-prod-second-group.yml', import.meta.url), 'utf8');
  const steps = wf.split(/\n      - /);
  const runStep = steps.find((s) => s.includes('node scripts/prod-g2-create.mjs'));
  assert.ok(runStep, 'run step present');
  assert.match(runStep, /openssl enc -d[^\n]*key\.pem/);
  assert.match(runStep, /export CHECK_KEY_PEM="\$ICP_HOME\/key\.pem"/);
  assert.ok(!steps.some((s) => s !== runStep && s.includes('key.pem')), 'no other step writes a key that would be deleted by its own trap');
});
