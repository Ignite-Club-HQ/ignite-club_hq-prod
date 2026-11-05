// Turns on secure own-name saving on the live (PROD) account service and its
// encrypted name store. check is read-only. enable merges the reviewed
// settings, restarts the name store on its exact current code so it reads
// them, and reads everything back. Never changes code, data or groups.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { assertCheckContext } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { SECURE_NAME_CONFIRMATION, SECURE_NAME_RECEIPT_PATH, planSecureNameSave, sameEnvironment } from './prod-secure-name-save-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const hex = b => Buffer.from(b).toString('hex');
const CHUNK = 1_000_000;
let stage = 'startup';

async function main() {
  const env = process.env, action = env.SECURE_NAME_ACTION;
  if (!['check', 'enable'].includes(action)) throw new Error('Only check or enable supported');
  if (action === 'enable' && env.CONFIRMATION?.trim() !== SECURE_NAME_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${SECURE_NAME_CONFIRMATION}`);
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const governor = identity.getPrincipal().toText();
  assertCheckContext(ids, env, governor);
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const pid = t => Principal.fromText(t);
  const Env = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
  const mgmtService = () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
      settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), environment_variables: IDL.Opt(Env) }) })], []),
    update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal,
      settings: IDL.Record({ environment_variables: IDL.Opt(Env) }) })], [], []),
    clear_chunk_store: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [], []),
    upload_chunk: IDL.Func([IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) })], [IDL.Record({ hash: IDL.Vec(IDL.Nat8) })], []),
    install_chunked_code: IDL.Func([IDL.Record({
      mode: IDL.Variant({ upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool),
        wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }),
      target_canister: IDL.Principal, store_canister: IDL.Opt(IDL.Principal),
      chunk_hashes_list: IDL.Vec(IDL.Record({ hash: IDL.Vec(IDL.Nat8) })), wasm_module_hash: IDL.Vec(IDL.Nat8),
      arg: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
  });
  const mgmt = id => Actor.createActor(mgmtService, { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: pid(id) });
  const readStatus = async id => {
    const s = await mgmt(id).canister_status({ canister_id: pid(id) });
    const rows = s.settings.environment_variables;
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : Array.isArray(rows) ? rows : [];
    return { controllers: s.settings.controllers.map(c => c.toText()),
      moduleHash: s.module_hash.length ? hex(Uint8Array.from(s.module_hash[0])) : null,
      environment: list.map(({ name, value }) => ({ name, value })) };
  };

  stage = 'read live services';
  const live = {};
  for (const name of ['pii_access_control', 'identity_access']) {
    live[ids[name]] = await readStatus(ids[name]);
    if (JSON.stringify(live[ids[name]].controllers) !== JSON.stringify([governor])) throw new Error(`${name} must be controlled only by the live signing key`);
  }
  const plan = planSecureNameSave(ids, live);

  stage = 'compare name-store build';
  const bytes = readFileSync(env.SECURE_NAME_PII_WASM);
  const hashes = [sha(bytes)];
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) hashes.push(sha(gunzipSync(bytes)));
  const piiLive = live[ids.pii_access_control].moduleHash;
  const piiMatches = hashes.includes(piiLive);
  // Only names are reported, never setting values.
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-secure-name-check.json'), JSON.stringify(
    plan.map(p => ({ name: p.name, done: p.done, adds: p.next.filter(r => !p.current.some(c => c.name === r.name && c.value === r.value)).map(r => r.name) })).concat([{ piiMatchesBuild: piiMatches }]), null, 2));
  if (!piiMatches) throw new Error('The live name store does not run the code on prod; merge first, nothing changed');

  const lines = plan.map(p => `- ${p.name}: ${p.done ? 'already on' : 'will be switched on'}`).join('\n');
  if (action === 'check') {
    const msg = `### PROD secure name saving check\n\n${lines}\n\nThe name store matches the prod build. No changes made.\n`;
    console.log(msg); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, msg);
    return;
  }

  const journal = githubJournal(env, fetch, { path: SECURE_NAME_RECEIPT_PATH, label: 'secure name saving' });
  let receipt = (await journal.load()) ?? { version: 1, steps: [] };
  const governorArg = Uint8Array.from(IDL.encode([IDL.Principal], [pid(governor)]));
  for (const p of plan) {
    stage = `settings ${p.name}`;
    if (!p.done) {
      receipt = { ...receipt, steps: [...receipt.steps, { name: p.name, phase: 'pending', at: new Date().toISOString() }] };
      await journal.save(receipt);
      // Re-read immediately before writing so nothing set meanwhile is lost.
      const fresh = await readStatus(p.id);
      if (!sameEnvironment(fresh.environment, p.current)) throw new Error(`${p.name} settings changed during the run; nothing written`);
      await mgmt(p.id).update_settings({ canister_id: pid(p.id), settings: { environment_variables: [p.next] } });
      if (!sameEnvironment((await readStatus(p.id)).environment, p.next)) throw new Error(`${p.name} settings readback failed`);
    }
    if (p.restart) {
      stage = `restart ${p.name}`;
      const m = mgmt(p.id);
      await m.clear_chunk_store({ canister_id: pid(p.id) });
      const chunks = [];
      for (let i = 0; i < bytes.length; i += CHUNK)
        chunks.push({ hash: (await m.upload_chunk({ canister_id: pid(p.id), chunk: bytes.subarray(i, i + CHUNK) })).hash });
      await m.install_chunked_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
        target_canister: pid(p.id), store_canister: [], chunk_hashes_list: chunks,
        wasm_module_hash: Buffer.from(sha(bytes), 'hex'), arg: governorArg, sender_canister_version: [] });
      await m.clear_chunk_store({ canister_id: pid(p.id) });
      const after = await readStatus(p.id);
      if (after.moduleHash !== piiLive) throw new Error('Name store code changed during restart');
      if (!sameEnvironment(after.environment, p.next)) throw new Error('Name store settings missing after restart');
    }
    receipt = { ...receipt, steps: [...receipt.steps, { name: p.name, phase: 'complete', at: new Date().toISOString() }], revision: env.GITHUB_SHA };
    await journal.save(receipt);
  }
  const msg = `### PROD secure name saving switched on\n\n${lines}\n\nName store restarted on identical code with data kept. Try a profile save on igniteclubhq.app.\n`;
  console.log(msg); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, msg);
}

main().catch(error => {
  const msg = `### PROD secure name saving stopped\n\nStage: ${stage}\n\nReason: ${String(error?.message ?? error).replace(/\b[a-z0-9]{5}(-[a-z0-9]{5}){4,}\b/g, '[principal]').slice(0, 2000)}\n`;
  console.error(msg); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
  process.exit(1);
});
