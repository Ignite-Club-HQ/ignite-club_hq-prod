// Runner for closed PROD second-group (g2) creation. Actions:
//   plan          read-only verification + durable reviewed plan receipt
//   inspect       read-only receipt and live status
//   create-closed checkpointed create/install/configure/health/photo-store sizing
// The group is never registered in the router, never opened, never given clubs.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { assertG2Context, buildG2CreationPlan, assertReviewedG2Plan, runG2Creation, resumeG2Intent,
  g2PlanSummary, G2_CREATE_CONFIRMATION, G2_CYCLES_PER_CANISTER, G2_RECEIPT_PATH, G2_SERVICES } from './prod-g2-create-policy.mjs';
import { setterService, blobStoreService, cyclesService, ledgerService, managementService } from './prod-g2-idl.mjs';
import { hashPlan as planHashOf } from './prod-base-group-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';
const CHUNK = 1_000_000;
const sha256 = bytes => new Uint8Array(createHash('sha256').update(bytes).digest());
const hex = bytes => Buffer.from(bytes).toString('hex');

let stage = 'startup';
const KNOWN_FAILURES = [
  'Only plan, inspect or create-closed supported',
  `Exact confirmation required: ${G2_CREATE_CONFIRMATION}`,
  'Reviewed plan hash required (64 lowercase hex characters)',
  'Reviewed plan hash does not match the saved g2 receipt',
  'Live inventory, modules, controller, subnet, worker or balance changed; re-plan',
  'Confirmed closed base receipt required',
  'Complete base-only registry required; existing or unknown g2 needs separate review',
  'Live closed base configuration differs from reviewed receipt',
  'Certified PROD infrastructure mismatch',
  'Valid existing push worker principal required',
  'Signing account balance below the estimated creation requirement; fund before creating',
  'Reviewed g2 plan receipt required',
  'Unresolved intent; reconcile without replay',
  'Refusing existing PROD base canister',
  'Duplicate g2 canister',
  'Configuration binding changed; stop without replay',
  'Invalid configuration receipts',
  'Create intent older than the ledger dedup window; reconcile by hand',
  'Create intent inconsistent with recorded canister',
  'Install intent for uncreated service',
  'Unknown pending intent; reconcile by hand',
  'Photo store size did not reach the planned capacity; stop without replay',
  'Journal acknowledgement mismatch; stop without replay',
  'Journal readback failed; stop without replay',
];
export function g2FailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  if (KNOWN_FAILURES.includes(message)) return message;
  if (/^Built \w+ module differs from the certified base module; review the source change first$/.test(message)) return message;
  if (/^Missing built module hash for \w+$/.test(message)) return message;
  if (/^\w+ landed on unapproved subnet; stop without replay$/.test(message)) return message;
  if (/^\w+ holds a different module; refusing to overwrite$/.test(message)) return message;
  if (/^Governor does not control \w+$/.test(message)) return message;
  if (/^\w+ failed health check$/.test(message)) return message;
  if (/^GitHub journal (GET|POST|PUT) failed \([0-9]{3}\); stop without replay$/.test(message)) return message;
  return 'Unclassified failure; inspect the saved stage and receipt without retrying creation';
}
export function saveG2Failure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: g2FailureReason(error), retryAuthorized: false };
  const message = `### PROD g2 creation stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry creation until the durable receipt is reviewed.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

/** Loads the 13 staged build artifacts and their module hashes (sha256 of the exact installed bytes). */
export function loadWasmHashes(wasmDir) {
  const hashes = {}, bytes = {};
  for (const name of G2_SERVICES) {
    const file = [`${name}.wasm.gz`, `${name}.wasm`].map(f => path.join(wasmDir, f)).find(existsSync);
    if (!file) throw new Error(`Missing built module hash for ${name}`);
    bytes[name] = new Uint8Array(readFileSync(file));
    hashes[name] = hex(sha256(bytes[name]));
  }
  return { hashes, bytes };
}

async function main() {
  const env = process.env, action = env.G2_ACTION;
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
  assertG2Context(ids, env, principal, action);
  const pushWorker = env.PUSH_WORKER_PRINCIPAL;

  stage = 'certified infrastructure readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const router = Actor.createActor(groupContract(IDL).reader, { agent, canisterId: ids.shard_router });
  const ledger = Actor.createActor(ledgerService(IDL), { agent, canisterId: CYCLES_LEDGER });
  const mgmt = id => Actor.createActor(managementService(IDL), { agent, canisterId: Principal.fromText('aaaaa-aa'), effectiveCanisterId: Principal.fromText(id) });
  const unwrap = r => { if ('Err' in r) throw new Error('Infrastructure operation refused; inspect signed readback, never replay'); return r.Ok; };
  const readRegistry = async () => JSON.parse(evidenceText(unwrap(await router.read_group_registry_page('mainnet', [], [], 64))));
  const observations = [];
  for (const name of Object.keys(ids).sort()) {
    const s = await CanisterStatus.request({ agent, canisterId: Principal.fromText(ids[name]), paths: ['controllers', 'module_hash', 'subnet'] });
    const module = s.get('module_hash');
    observations.push({ name, id: ids[name], moduleHash: typeof module === 'string' ? module : hex(module ?? []),
      controllers: (s.get('controllers') ?? []).map(p => p.toText()), subnet: s.get('subnet')?.subnetId });
  }
  const page = await readRegistry();
  const balance = await ledger.icrc1_balance_of({ owner: Principal.fromText(principal), subaccount: [] });

  stage = 'load durable receipts';
  const baseJournal = githubJournal(env);
  const g2Journal = githubJournal(env, fetch, { path: G2_RECEIPT_PATH, label: 'g2 creation' });
  const baseReceipt = await baseJournal.load({ readOnly: true });
  const receipt = await g2Journal.load({ readOnly: action === 'inspect' });
  if (receipt) writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-receipt.json'), evidenceText(receipt));

  if (action === 'inspect') {
    const report = { receiptPhase: receipt?.phase ?? 'missing', pending: receipt?.pending ?? null,
      canisters: receipt?.canisters ?? {}, installedDomains: receipt?.installedDomains ?? [],
      configurationCompleted: receipt?.configuration?.completed?.length ?? 0,
      configurationTotal: CONFIGURATION_RECIPE.length,
      sourceChanged: receipt?.plan?.sourceCommit !== env.GITHUB_SHA, creationAuthorized: false };
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-inspection.json'), evidenceText(report));
    const message = `### PROD g2 read-only inspection\n\nReceipt: ${report.receiptPhase}; pending: ${report.pending ? `${report.pending.kind} ${report.pending.domain ?? ''}` : 'none'}.\nCreated services: ${Object.keys(report.canisters).length}/13; installed: ${report.installedDomains.length}/13; configuration operations: ${report.configurationCompleted}/34.\nSource commit changed: ${report.sourceChanged ? 'yes' : 'no'}.\nNo journal or canister writes. The group stays CLOSED.\n`;
    console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  stage = 'verify built modules against certified base modules';
  const { hashes, bytes } = loadWasmHashes(env.G2_WASM_DIR);
  const plan = buildG2CreationPlan({ ids, env, principal, baseReceipt, page, observations,
    wasmHashes: hashes, pushWorker, balance, checkedAt: new Date().toISOString() });

  if (action === 'plan') {
    if (receipt?.pending || (receipt && receipt.phase !== 'planned'))
      throw new Error('Unresolved intent; reconcile without replay');
    const planned = { version: 1, phase: 'planned', pending: null, planHash: planHashOf(plan), plan };
    await g2Journal.save(planned);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-plan.json'), evidenceText(planned));
    const summary = g2PlanSummary(plan);
    console.log(summary); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    return;
  }

  // create-closed
  if (!receipt) throw new Error('Reviewed g2 plan receipt required');
  stage = 'verify reviewed plan against current source and infrastructure';
  assertReviewedG2Plan(receipt.plan, env.G2_PLAN_HASH, plan);

  const pid = id => Principal.fromText(id);
  const governorArg = IDL.encode([IDL.Principal], [pid(principal)]);
  const calls = {
    wasm: name => bytes[name],
    initArg: name => name === 'timer_jobs' ? IDL.encode([], []) : governorArg, // timer_jobs captures its installer as governor
    environment: name => name === 'pii_access_control' ? [{ name: 'VETKD_KEY_NAME', value: 'key_1' }]
      : name === 'media_blob_store' ? [{ name: 'GOVERNOR_PRINCIPAL', value: principal }, { name: 'IGNITE_MEDIA_LARGE_CAPACITY', value: '1' }] : [],
    async createCanister({ createdAtNs, amount, subnetId, controllers }) {
      const r = await ledger.create_canister({ from_subaccount: [], created_at_time: [createdAtNs], amount,
        creation_args: [{ settings: [{ controllers: [controllers.map(pid)] }], subnet_selection: [{ Subnet: { subnet: pid(subnetId) } }] }] });
      if ('Ok' in r) return { canisterId: r.Ok.canister_id.toText() };
      if ('Duplicate' in r.Err && r.Err.Duplicate.canister_id.length) return { duplicateOf: r.Err.Duplicate.canister_id[0].toText() };
      throw new Error('Infrastructure operation refused; inspect signed readback, never replay');
    },
    subnetOf: async id => (await agent.getSubnetIdFromCanister(pid(id))).toText(),
    async status(id) {
      const s = await mgmt(id).canister_status({ canister_id: pid(id) });
      return { controllers: s.settings.controllers.map(c => c.toText()),
        moduleHash: s.module_hash.length ? hex(Uint8Array.from(s.module_hash[0])) : null, running: 'running' in s.status };
    },
    setEnvironment: (id, vars) => mgmt(id).update_settings({ canister_id: pid(id), settings: { environment_variables: [vars] } }),
    async installChunked(id, wasm, arg) {
      const m = mgmt(id);
      await m.clear_chunk_store({ canister_id: pid(id) });
      const hashesList = [];
      for (let i = 0; i < wasm.length; i += CHUNK) {
        const chunk = wasm.subarray(i, i + CHUNK);
        const { hash } = await m.upload_chunk({ canister_id: pid(id), chunk });
        if (hex(Uint8Array.from(hash)) !== hex(sha256(chunk))) throw new Error('Chunk hash mismatch');
        hashesList.push({ hash: Uint8Array.from(hash) });
      }
      await m.install_chunked_code({ mode: { install: null }, target_canister: pid(id), store_canister: [], chunk_hashes_list: hashesList,
        wasm_module_hash: sha256(wasm), arg, sender_canister_version: [] });
    },
    cyclesOf: async id => Actor.createActor(cyclesService(IDL), { agent, canisterId: pid(id) }).cycles_balance(),
    async configure(domain, id, method, args) {
      const actor = Actor.createActor(setterService(IDL, domain), { agent, canisterId: pid(id) });
      unwrap(await actor[method](...args.map(a => Array.isArray(a) ? a.map(pid) : pid(a))));
    },
    blobStableEnabled: async id => (await Actor.createActor(blobStoreService(IDL), { agent, canisterId: pid(id) }).stable_storage_status()).enabled,
    blobEnableStable: async id => unwrap(await Actor.createActor(blobStoreService(IDL), { agent, canisterId: pid(id) }).enable_stable_media_storage()),
    blobSetCapacity: async (id, size) => unwrap(await Actor.createActor(blobStoreService(IDL), { agent, canisterId: pid(id) }).set_capacity_limit(size)),
    blobCapacity: async id => (await Actor.createActor(blobStoreService(IDL), { agent, canisterId: pid(id) }).get_usage()).capacity_limit_bytes,
  };

  const checkpoint = async r => {
    stage = `durable checkpoint: ${r.pending ? `${r.pending.kind} ${r.pending.domain ?? ''}` : r.phase}`;
    await g2Journal.save(r);
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-receipt.json'), evidenceText(r));
  };

  stage = 'resume unresolved intent';
  let current = receipt;
  while (current.pending) current = await resumeG2Intent({ plan, receipt: current, checkpoint, calls, nowNs: () => BigInt(Date.now()) * 1_000_000n });

  stage = 'closed creation';
  const result = await runG2Creation({ plan, receipt: current, checkpoint, calls, nowNs: () => BigInt(Date.now()) * 1_000_000n });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-result.json'), evidenceText(result));
  const lines = Object.entries(result.canisters).map(([n, id]) => `${n.padEnd(22)} ${id}`).join('\n');
  const message = `### PROD second group created CLOSED\n\n13 independent services created, installed with the certified base modules, configured and health-checked.\n\n${lines}\n\nThe group is NOT registered in the router, receives no clubs and stays CLOSED. Registration, routing approval and admission remain separate reviewed steps. No DEV or database changes.\n`;
  console.log(message); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  saveG2Failure(process.env, error, stage);
  process.exitCode = 1;
});
