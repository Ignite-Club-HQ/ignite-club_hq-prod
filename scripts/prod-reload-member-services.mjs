// Reloads the 24 PROD member services with their exact current code (upgrade,
// memory kept) so they read the settings applied by member access. check is
// read-only; reload requires every service to match the build first.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText, assertCheckContext } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { MEMBER_ACCESS_RECEIPT_PATH } from './prod-member-access-policy.mjs';
import { RELOAD_CONFIRMATION, RELOAD_RECEIPT_PATH, NO_ARG_SERVICES, reloadTargets, assertReloadReady } from './prod-reload-member-services-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const hex = b => Buffer.from(b).toString('hex');
const CHUNK = 1_000_000;
let stage = 'startup';

async function main() {
  const env = process.env, action = env.RELOAD_ACTION;
  if (!['check', 'reload'].includes(action)) throw new Error('Only check or reload supported');
  if (action === 'reload' && env.CONFIRMATION?.trim() !== RELOAD_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${RELOAD_CONFIRMATION}`);
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

  stage = 'load member-access receipt';
  const memberReceipt = await githubJournal(env, fetch, { path: MEMBER_ACCESS_RECEIPT_PATH, label: 'member access' }).load({ readOnly: true });
  const targets = reloadTargets(memberReceipt);

  stage = 'load builds';
  const builds = {};
  for (const name of new Set(targets.map(t => t.name))) {
    const base = path.join(env.RELOAD_WASM_DIR, name);
    const file = existsSync(base + '.wasm.gz') ? base + '.wasm.gz' : base + '.wasm';
    const bytes = readFileSync(file);
    const hashes = [sha(bytes)];
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) hashes.push(sha(gunzipSync(bytes)));
    builds[name] = { bytes, hashes };
  }

  stage = 'read live services';
  const status = {};
  for (const t of targets) status[t.id] = await readStatus(t.id);
  const report = targets.map(t => ({ ...t, liveHash: status[t.id].moduleHash,
    matchesBuild: builds[t.name].hashes.includes(status[t.id].moduleHash) }));
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-member-reload-check.json'), evidenceText(report));
  assertReloadReady({ targets, status, builds, governor, identity: ids.identity_access });

  if (action === 'check') {
    const msg = `### PROD member service reload check\n\nAll 24 services run exactly this build and carry the reviewed settings. Ready to reload. No changes made.\n`;
    console.log(msg); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, msg);
    return;
  }

  const journal = githubJournal(env, fetch, { path: RELOAD_RECEIPT_PATH, label: 'member reload' });
  let receipt = (await journal.load()) ?? { version: 1, reloaded: [] };
  const governorArg = Uint8Array.from(IDL.encode([IDL.Principal], [pid(governor)]));
  const emptyArg = Uint8Array.from(IDL.encode([], []));
  for (const t of targets) {
    stage = `reload ${t.name} (${t.group})`;
    const wasm = builds[t.name].bytes;
    const m = mgmt(t.id);
    await m.clear_chunk_store({ canister_id: pid(t.id) });
    const chunks = [];
    for (let i = 0; i < wasm.length; i += CHUNK)
      chunks.push({ hash: (await m.upload_chunk({ canister_id: pid(t.id), chunk: wasm.subarray(i, i + CHUNK) })).hash });
    await m.install_chunked_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
      target_canister: pid(t.id), store_canister: [], chunk_hashes_list: chunks,
      wasm_module_hash: Buffer.from(sha(wasm), 'hex'),
      arg: NO_ARG_SERVICES.includes(t.name) ? emptyArg : governorArg, sender_canister_version: [] });
    await m.clear_chunk_store({ canister_id: pid(t.id) });
    const after = await readStatus(t.id);
    if (after.moduleHash !== status[t.id].moduleHash) throw new Error(`${t.name} code changed unexpectedly after reload`);
    receipt = { ...receipt, reloaded: [...new Set([...receipt.reloaded, t.id])], at: new Date().toISOString() };
    await journal.save(receipt);
    console.log(`reloaded ${t.name} ${t.group} ${t.id}`);
  }
  const msg = `### PROD member services reloaded\n\nAll 24 services restarted on their exact current code with data kept; settings untouched. Groups stay closed. Run member-access commission next.\n`;
  console.log(msg); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, msg);
}

main().catch(error => {
  const msg = `### PROD member service reload stopped\n\nStage: ${stage}\n\nReason: ${String(error?.message ?? error).replace(/\b[a-z0-9]{5}(-[a-z0-9]{5}){4,}\b/g, '[principal]').slice(0, 2000)}\n`;
  console.error(msg); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
  process.exit(1);
});
