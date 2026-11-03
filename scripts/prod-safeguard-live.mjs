// Live closed safeguard setup. One step per job (SAFEGUARD_JOB):
//   create  governor pays; the new witness's ONLY controller is the recovery key
//   install recovery key installs the reviewed witness program bound to identity_access
//   pin     governor upgrades identity_access only (never reinstalls) with immutable pins
// Each external action saves an intent first and reads back afterwards; unknown
// outcomes stop. Protections stay off, nothing is signed and both groups stay closed.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { identityFromPem } from './prod-connection-check.mjs';
import { PROD_CHECK_IDS, assertCheckContext, evidenceText } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { ledgerService } from './prod-g2-idl.mjs';
import { accountPublicKey, openAccountSeed } from './prod-account-key-policy.mjs';
import { assertSafeguardContext, publicPins, assertGroupsClosed, stepState, assertSamePlan, assertWitnessState,
  identityPinEnv, SAFEGUARD_RECEIPT, KEY_RECEIPT, WITNESS_CYCLES } from './prod-safeguard-live-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';
const CHUNK = 1_000_000;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const nowNs = () => (BigInt(Date.now()) * 1_000_000n).toString();
let stage = 'startup';

function managementIdl(IDL) {
  const mode = IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool),
    wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) });
  return () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal) }) })], []),
    clear_chunk_store: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [], []),
    upload_chunk: IDL.Func([IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) })], [IDL.Record({ hash: IDL.Vec(IDL.Nat8) })], []),
    install_chunked_code: IDL.Func([IDL.Record({ mode, target_canister: IDL.Principal, store_canister: IDL.Opt(IDL.Principal),
      chunk_hashes_list: IDL.Vec(IDL.Record({ hash: IDL.Vec(IDL.Nat8) })), wasm_module_hash: IDL.Vec(IDL.Nat8),
      arg: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
  });
}
const witnessIdl = IDL => () => IDL.Service({
  read_recovery_runtime_version: IDL.Func([], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
  read_recovery_head: IDL.Func([], [IDL.Variant({ Ok: IDL.Record({ epoch: IDL.Nat64, revision: IDL.Nat64,
    digest: IDL.Vec(IDL.Nat8), accepted: IDL.Opt(IDL.Reserved) }), Err: IDL.Text })], []),
});

function artifact(dir, name) {
  const file = [path.join(dir, name), path.join(dir, `${name}.wasm`)].find(existsSync);
  if (!file) throw Error(`Built ${name} program missing`);
  return new Uint8Array(readFileSync(file));
}
const contains = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text));

async function main() {
  const env = process.env;
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  stage = 'context';
  assertSafeguardContext(env);
  const job = env.SAFEGUARD_JOB;
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor, CanisterStatus } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const ids = { ...PROD_CHECK_IDS };
  const pid = t => Principal.fromText(t);

  stage = 'signing identity';
  let identity;
  if (job === 'install') {
    if (env.KEY_ENVIRONMENT !== 'production-recovery-approval') throw Error('Recovery environment required');
    const seed = openAccountSeed((env.EXISTING_ENC ?? '').trim(), env.PASSPHRASE);
    if (accountPublicKey(seed) !== env.EXISTING_PUBLIC_KEY) throw Error('Recovery key does not match its public pin');
    identity = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(Buffer.from(seed, 'hex')));
    if (identity.getPrincipal().toText() !== env.EXISTING_PRINCIPAL) throw Error('Recovery key does not match its principal');
  } else {
    identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
    const mapped = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
    assertCheckContext(mapped, env, identity.getPrincipal().toText());
  }
  const me = identity.getPrincipal().toText();
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const mgmt = id => Actor.createActor(managementIdl(IDL), { agent, canisterId: pid('aaaaa-aa'), effectiveCanisterId: pid(id) });
  const certified = async id => {
    const s = await CanisterStatus.request({ agent, canisterId: pid(id), paths: ['controllers', 'module_hash', 'subnet'] });
    const m = s.get('module_hash');
    return { controllers: (s.get('controllers') ?? []).map(p => p.toText()).sort(),
      moduleHash: m ? (typeof m === 'string' ? m.replace(/^0x/, '') : Buffer.from(m).toString('hex')) : null, subnet: s.get('subnet')?.subnetId };
  };
  const router = Actor.createActor(groupContract(IDL).reader, { agent, canisterId: pid(ids.shard_router) });
  const assertClosed = async () => {
    const r = await router.read_group_registry_page('mainnet', [], [], 64);
    if ('Err' in r) throw Error('Group registry unreadable');
    assertGroupsClosed(JSON.parse(evidenceText(r.Ok)));
  };

  stage = 'receipts';
  const journal = githubJournal(env, fetch, SAFEGUARD_RECEIPT);
  const readKey = role => githubJournal(env, fetch, KEY_RECEIPT(role)).load({ readOnly: true });
  const pins = publicPins(await readKey('account'), await readKey('recovery'), env);
  let receipt = await journal.load();
  const save = async r => { receipt = r; await journal.save(r); writeFileSync(path.join(env.CHECK_REPORT_DIR, 'safeguard-receipt.json'), evidenceText(r)); };
  await assertClosed();
  const state = stepState(receipt, job);
  const report = msg => { console.log(msg); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${msg}\n\n`); };
  if (state === 'done') { report(`Step ${job} already complete (phase ${receipt.phase}); nothing changed.`); return; }

  if (job === 'create') {
    stage = 'reviewed safeguard build';
    const wasm = artifact(env.WITNESS_DIR, 'recovery_witness');
    if (!contains(wasm, pins.recoveryPublicKey)) throw Error('Safeguard build lacks the recovery public pin');
    const subnet = (await agent.getSubnetIdFromCanister(pid(ids.identity_access))).toText();
    const plan = { identity: ids.identity_access, subnet, witnessModuleHash: sha256(wasm), governor: me, pins };
    if (!receipt) await save({ version: 1, phase: 'planned', pending: null, sourceCommit: env.GITHUB_SHA, ...plan,
      witness: null, protectionsEnabled: false, openingAuthorized: false });
    assertSamePlan(receipt, plan);
    stage = 'funding check';
    const ledger = Actor.createActor(ledgerService(IDL), { agent, canisterId: pid(CYCLES_LEDGER) });
    if (!receipt.pending) {
      const balance = await ledger.icrc1_balance_of({ owner: pid(me), subaccount: [] });
      if (balance < WITNESS_CYCLES + 1_000_000_000n) throw Error('Governor cycles below the safeguard creation amount');
      await save({ ...receipt, pending: { kind: 'create', atNs: nowNs() } });
    }
    stage = 'create safeguard (ledger-deduplicated)';
    const r = await ledger.create_canister({ from_subaccount: [], created_at_time: [BigInt(receipt.pending.atNs)], amount: WITNESS_CYCLES,
      creation_args: [{ settings: [{ controllers: [[pid(pins.recoveryPrincipal)]] }], subnet_selection: [{ Subnet: { subnet: pid(subnet) } }] }] });
    const witness = 'Ok' in r ? r.Ok.canister_id.toText()
      : ('Duplicate' in r.Err && r.Err.Duplicate.canister_id.length ? r.Err.Duplicate.canister_id[0].toText() : null);
    if (!witness) throw Error('Safeguard creation refused; inspect receipt, never replay blindly');
    if (Object.values(ids).includes(witness)) throw Error('Distinct safeguard required');
    stage = 'safeguard creation readback';
    assertWitnessState(await certified(witness), receipt, { installed: false });
    await save({ ...receipt, witness, phase: 'witness-created', pending: null });
    writeFileSync(path.join(env.WITNESS_DIR, 'expected.sha256'), receipt.witnessModuleHash);
    report(`### Safeguard service created\n\nAddress: ${witness}\n\nOnly controller: the recovery key (${pins.recoveryPrincipal}). Program fingerprint to install: ${receipt.witnessModuleHash}.`);
    return;
  }

  if (job === 'install') {
    if (me !== receipt.pins.recoveryPrincipal) throw Error('Recovery key does not match the recorded safeguard controller');
    assertSamePlan(receipt, { ...receipt, pins });
    stage = 'reviewed safeguard program';
    const wasm = artifact(env.WITNESS_DIR, 'recovery_witness');
    if (sha256(wasm) !== receipt.witnessModuleHash) throw Error('Safeguard program differs from the recorded build');
    const live = await certified(receipt.witness);
    const alreadyInstalled = receipt.pending && live.moduleHash === receipt.witnessModuleHash;
    assertWitnessState(live, receipt, { installed: alreadyInstalled });
    if (!alreadyInstalled) {
      if (!receipt.pending) await save({ ...receipt, pending: { kind: 'install', atNs: nowNs() } });
      stage = 'install safeguard program';
      const m = mgmt(receipt.witness);
      await m.clear_chunk_store({ canister_id: pid(receipt.witness) });
      const hashes = [];
      for (let i = 0; i < wasm.length; i += CHUNK) hashes.push({ hash: Uint8Array.from((await m.upload_chunk({ canister_id: pid(receipt.witness), chunk: wasm.subarray(i, i + CHUNK) })).hash) });
      const arg = IDL.encode([IDL.Record({ governor: IDL.Principal, identity: IDL.Principal })], [{ governor: pid(me), identity: pid(receipt.identity) }]);
      await m.install_chunked_code({ mode: { install: null }, target_canister: pid(receipt.witness), store_canister: [], chunk_hashes_list: hashes,
        wasm_module_hash: Buffer.from(receipt.witnessModuleHash, 'hex'), arg: new Uint8Array(arg), sender_canister_version: [] });
    }
    stage = 'safeguard installation readback';
    assertWitnessState(await certified(receipt.witness), receipt, { installed: true });
    const w = Actor.createActor(witnessIdl(IDL), { agent, canisterId: pid(receipt.witness) });
    const version = await w.read_recovery_runtime_version();
    const head = await w.read_recovery_head();
    if ('Err' in version || 'Err' in head || head.Ok.accepted.length) throw Error('Safeguard did not answer its operator as a fresh service');
    await save({ ...receipt, phase: 'witness-installed', pending: null });
    report(`### Safeguard service installed\n\nAddress: ${receipt.witness}; program ${receipt.witnessModuleHash}; bound to identity ${receipt.identity}; no sign-off accepted yet.`);
    return;
  }

  // pin
  if (me !== receipt.governor) throw Error('Governor changed since the safeguard plan');
  assertSamePlan(receipt, { ...receipt, pins });
  stage = 'safeguard readback before pinning';
  assertWitnessState(await certified(receipt.witness), receipt, { installed: true });
  stage = 'build pinned identity program';
  const pinEnv = identityPinEnv(receipt, ids);
  execFileSync('icp', ['build', 'identity_access'], { cwd: path.join(ROOT, 'deploy/prod'), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...pinEnv } });
  const artifacts = path.join(ROOT, 'deploy/prod/.icp/cache/artifacts');
  const wasm = artifact(artifacts, readdirSync(artifacts).find(f => f.startsWith('identity_access')) ?? 'identity_access');
  if (!contains(wasm, receipt.witness) || !contains(wasm, receipt.pins.accountPublicKey)) throw Error('Identity build lacks the immutable pins');
  const identityHash = sha256(wasm);
  const before = await certified(ids.identity_access);
  if (!before.controllers.includes(me)) throw Error('Governor does not control identity_access');
  if (!(receipt.pending && before.moduleHash === identityHash)) {
    if (receipt.pending && receipt.pending.identityModuleHash !== identityHash) throw Error('Pending identity upgrade used a different build; reconcile by hand');
    if (!receipt.pending) await save({ ...receipt, pending: { kind: 'pin', atNs: nowNs(), identityModuleHash: identityHash, identityModuleBefore: before.moduleHash } });
    stage = 'upgrade identity only (memory kept)';
    const m = mgmt(ids.identity_access);
    await m.clear_chunk_store({ canister_id: pid(ids.identity_access) });
    const hashes = [];
    for (let i = 0; i < wasm.length; i += CHUNK) hashes.push({ hash: Uint8Array.from((await m.upload_chunk({ canister_id: pid(ids.identity_access), chunk: wasm.subarray(i, i + CHUNK) })).hash) });
    await m.install_chunked_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [] }] }, target_canister: pid(ids.identity_access),
      store_canister: [], chunk_hashes_list: hashes, wasm_module_hash: Buffer.from(identityHash, 'hex'), arg: new Uint8Array(IDL.encode([], [])), sender_canister_version: [] });
  }
  stage = 'identity readback';
  const after = await certified(ids.identity_access);
  if (after.moduleHash !== identityHash || JSON.stringify(after.controllers) !== JSON.stringify(before.controllers)) throw Error('Identity readback mismatch');
  await assertClosed();
  await save({ ...receipt, phase: 'identity-pinned', pending: null, identityModuleHash: identityHash,
    identityModuleBefore: receipt.pending?.identityModuleBefore ?? before.moduleHash, identityPins: pinEnv });
  report(`### Identity service pinned (upgrade only)\n\nSafeguard ${receipt.witness}; account key ${receipt.pins.accountPublicKey}; recovery key ${receipt.pins.recoveryPublicKey}.\n\nIdentity program ${identityHash} (was ${receipt.identityModuleBefore}). Protections remain off; both groups closed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Fixed messages only; never print key material or raw replies.
  const msg = error instanceof Error && /^[A-Z][A-Za-z ,;:'()\-]{5,120}$/.test(error.message) ? error.message : 'unclassified; inspect receipt, do not retry blindly';
  const text = `### Safeguard setup stopped\n\nStage: ${stage}\n\nReason: ${msg}\n`;
  console.error(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exitCode = 1;
});
