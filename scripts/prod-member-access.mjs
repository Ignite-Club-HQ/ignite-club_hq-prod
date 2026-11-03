// Admission-only PROD member access runner. Reads live router, account-service
// and per-service settings, then either records a reviewable plan or applies a
// previously reviewed one: bind each of the 24 member readers to the account
// service with admission on, then commission ordinary member access on the
// account service itself. It never writes the global removal setting and never
// opens a group. Every stage is journalled and read back before the next one.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText, assertCheckContext } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { IDENTITY_LINK_RECEIPT_PATH, mergeEnvironment } from './prod-identity-link-policy.mjs';
import { settingsCommitment } from './prod-protection-policy.mjs';
import {
  MEMBER_ACCESS_RECEIPT_PATH, MEMBER_ACCESS_CONFIRMATION, MEMBER_ACCESS_READBACK_CONFIRMATION,
  MEMBER_ACCESS_ACTIONS, memberAccessTargets, buildMemberAccessPlan, assertReviewedMemberAccessPlan,
  assertMemberAccessReadback, memberAccessSummary,
} from './prod-member-access-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let stage = 'startup';
const KNOWN_FAILURES = [
  'Only plan, inspect, apply, commission or readback supported',
  'Exact confirmation required: ENABLE PROD MEMBER ACCESS',
  'Exact confirmation required: CONFIRM PROD MEMBER ACCESS READBACK',
  'Connection check requires the live repository prod branch',
  'Connection check requires the exact recorded 18-service PROD inventory',
  'Both groups must be registered and closed',
  'group must expose exactly the twelve reviewed human domains',
  'Exactly twenty-four member readers across both groups required',
  'Unexpected shared member reader',
  'Acknowledged account-service link receipt required before member access',
  'Account-service link receipt carries no registry binding',
  'must be decimal text',
  'Account service must trust the live router as its registry',
  'Registry has moved since the account service pinned it; re-link before member access',
  'Account service has not pinned its registry',
  'Account service is not pinned to the reviewed registry',
  'Bound deletion must read back as released before member access',
  'Current settings unavailable for',
  'Current environment settings required',
  'Rehearsal forbidden on production',
  'Global account removal is already released; ordinary access requires separate review',
  'Foreign account authority requires separate review',
  'Unique valid environment settings required',
  'Reviewed plan hash required (64 lowercase hex characters)',
  'Reviewed plan hash does not match the saved member-access receipt',
  'changed; re-plan before applying',
  'Closed-only member access required',
  'A member-access receipt already exists; use a read-only pass',
  'No member-access receipt exists yet; run plan first',
  'Member-access settings have not been applied yet',
  'Member-access delivery is already commissioned',
  'Unresolved member-access intent',

  'Account admission did not read back as released',
  'Bound deletion did not read back as released',
  'Ordinary member access did not read back',
  'Global account operations must remain deferred under ordinary access',
  'Registry inventory changed during member access delivery',
  'Settings readback unavailable for',
  'is not bound to the reviewed account service',
  'admission is not enabled',
  'must keep global removal off',
  'must keep rehearsal off',
  'Router refused the bounded registry read',
  'Account service refused the governor-only configuration read',
  'Service refused the environment read',
  'Service refused the environment write',
  'Account service refused the member access commissioning request',
];

/**
 * A known refusal is quoted; anything else is replaced by a fixed sentence. A
 * provider or transport error can echo an argument, so principal-shaped tokens
 * are redacted from every reason before it reaches the workflow log or artifact.
 */
export function memberAccessFailureReason(text) {
  const message = String(text ?? '').slice(0, 240).replace(/[\r\n]+/g, ' ')
    .replace(/\b[a-z0-9]{5}(-[a-z0-9]{5})+\b/g, '[principal]');
  return KNOWN_FAILURES.some(known => message.includes(known)) ? message :
    'Member access delivery stopped before completing; review the exact workflow log and receipt before retrying';
}

export function saveMemberAccessFailure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: memberAccessFailureReason(error?.message),
    action: env.MEMBER_ACTION ?? null, retryAuthorized: false };
  const message = `### PROD member access delivery stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry until the durable receipt is reviewed.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-member-access-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

async function main() {
  const env = process.env, action = env.MEMBER_ACTION;
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
  assertCheckContext(ids, env, principal);
  if (!MEMBER_ACCESS_ACTIONS.includes(action))
    throw new Error('Only plan, inspect, apply, commission or readback supported');
  if ((action === 'apply' || action === 'commission') && env.CONFIRMATION?.trim() !== MEMBER_ACCESS_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${MEMBER_ACCESS_CONFIRMATION}`);
  if (action === 'readback' && env.CONFIRMATION?.trim() !== MEMBER_ACCESS_READBACK_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${MEMBER_ACCESS_READBACK_CONFIRMATION}`);

  stage = 'live router, account service and service settings readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const contract = groupContract(IDL);
  const Pairs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const Result = ok => IDL.Variant({ Ok: ok, Err: IDL.Text });
  const Binding = IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64, target_alias: IDL.Text,
    deployment_id: IDL.Text, deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text });
  const configReader = () => IDL.Service({ read_group_opening_configuration: IDL.Func([], [Result(Pairs)], []) });
  const commissionService = () => IDL.Service({
    authorize_production_member_access: IDL.Func([Binding], [Result(IDL.Null)], []),
  });
  const environment = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
  const managementService = () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      settings: IDL.Record({ environment_variables: IDL.Opt(environment) }) })], []),
    update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal,
      settings: IDL.Record({ environment_variables: IDL.Opt(environment) }) })], [], []),
  });
  const unwrap = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
  const pid = text => Principal.fromText(text);
  const actor = (service, canisterId) => Actor.createActor(service, { agent, canisterId });
  const mgmt = canisterId => Actor.createActor(managementService, { agent, canisterId: 'aaaaa-aa',
    effectiveCanisterId: pid(canisterId) });
  const unwrapEnvironment = status => {
    const rows = status?.settings?.environment_variables;
    if (rows === undefined || rows === null || (Array.isArray(rows) && rows.length === 0)) return [];
    const list = Array.isArray(rows) ? rows[0] : rows;
    if (!Array.isArray(list)) throw new Error('Service refused the environment read');
    return list.map(({ name, value }) => ({ name, value }));
  };

  const readRegistryPage = async () => JSON.parse(evidenceText(unwrap(await actor(contract.reader, ids.shard_router)
    .read_group_registry_page('mainnet', [], [], 64))));
  const readIdentityConfig = async () => {
    const reply = await actor(configReader, ids.identity_access).read_group_opening_configuration();
    if ('Err' in reply) {
      if (reply.Err === 'Deletion registry not pinned') return null;
      throw new Error('Account service refused the governor-only configuration read');
    }
    return reply.Ok;
  };
  const readEnvironment = async canisterId => unwrapEnvironment(await mgmt(canisterId)
    .canister_status({ canister_id: pid(canisterId) }));
  const readEnvironments = async targets => {
    const rows = {};
    for (const target of targets) rows[target.id] = await readEnvironment(target.id);
    return rows;
  };

  stage = 'load durable receipts';
  const linkJournal = githubJournal(env, fetch, { path: IDENTITY_LINK_RECEIPT_PATH, label: 'account-service link' });
  const journal = githubJournal(env, fetch, { path: MEMBER_ACCESS_RECEIPT_PATH, label: 'member access' });
  const receiptPath = () => path.join(env.CHECK_REPORT_DIR, 'prod-member-access-receipt.json');
  const checkpoint = async receipt => {
    stage = `durable checkpoint: ${receipt.pending ?? receipt.phase}`;
    await journal.save(receipt);
    writeFileSync(receiptPath(), evidenceText(receipt));
    stage = `after acknowledged checkpoint: ${receipt.pending ?? receipt.phase}`;
  };
  const input = async checkedAt => {
    const page = await readRegistryPage();
    const targets = memberAccessTargets(ids, page);
    return { ids, env, principal, page, targets,
      identityConfig: await readIdentityConfig(), linkReceipt: await linkJournal.load({ readOnly: true }),
      environments: await readEnvironments(targets), checkedAt: checkedAt ?? new Date().toISOString() };
  };

  if (action === 'inspect') {
    stage = 'read-only inspection (no writes)';
    const receipt = await journal.load({ readOnly: true });
    const state = await input();
    const report = {
      receiptPhase: receipt?.phase ?? 'missing', pending: receipt?.pending ?? null,
      savedSourceCommit: receipt?.plan?.sourceCommit ?? null, currentSourceCommit: env.GITHUB_SHA,
      sourceChanged: receipt?.plan?.sourceCommit !== env.GITHUB_SHA,
      groups: state.page.groups.map(group => `${group.id}:${group.accepting ? 'OPEN' : 'CLOSED'}`),
      identityRows: Object.fromEntries(state.identityConfig ?? []),
      readers: state.targets.map(target => {
        const rows = new Map((state.environments[target.id] ?? []).map(row => [row.name, row.value]));
        return { name: target.name, group: target.group, id: target.id,
          bound: rows.get('IGNITE_ACCOUNT_SERVICE_IDENTITY') === ids.identity_access,
          admission: rows.get('IGNITE_ACCOUNT_ADMISSION_RELEASE') === '1',
          removal: rows.get('IGNITE_ACCOUNT_REMOVAL_RELEASE') === '1',
          rehearsal: rows.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL') === '1' };
      }),
      openingAuthorized: false, removalReleaseAuthorized: false,
    };
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-member-access-inspection.json'), evidenceText(report));
    const bound = report.readers.filter(r => r.bound).length, enabled = report.readers.filter(r => r.admission).length;
    const message = `### PROD member access read-only inspection\n\nMember-access receipt: ${report.receiptPhase}; pending: ${report.pending ?? 'none'}.\nReader services bound to the account service: ${bound} of ${report.readers.length}; with admission enabled: ${enabled}.\nGlobal removal set anywhere: ${report.readers.some(r => r.removal) ? 'yes' : 'no'}; rehearsal anywhere: ${report.readers.some(r => r.rehearsal) ? 'yes' : 'no'}.\nGroups: ${report.groups.join(', ')}.\nNo environment write, commissioning request, approval or opening.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  if (action === 'plan') {
    stage = 'build current closed-only member access plan';
    if (await journal.load({ readOnly: true }))
      throw new Error('A member-access receipt already exists; use a read-only pass');
    const plan = buildMemberAccessPlan(await input());
    const planned = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan };
    await checkpoint(planned);
    const message = `${memberAccessSummary(plan)}\n\nReviewed-plan hash: \`${planned.planHash}\`\n\nTwo effects: write the two admission settings to the reader services above, then commission ordinary member access on \`${plan.identityAccess}\`. Both groups stay CLOSED. Global removal, erasure and recovery stay off.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  stage = 'verify reviewed plan against current source and infrastructure';
  const receipt = await journal.load({ readOnly: true });
  if (!receipt) throw new Error('No member-access receipt exists yet; run plan first');
  assertReviewedMemberAccessPlan(receipt.plan, env.MEMBER_PLAN_HASH,
    buildMemberAccessPlan(await input(receipt.plan.checkedAt)));

  if (action === 'apply') {
    if (receipt.phase !== 'planned') throw new Error('Member-access settings have already been applied');
    if (receipt.pending && !String(receipt.pending).startsWith('settings:'))
      throw new Error('Unresolved member-access intent; review the receipt before applying');
    for (const target of receipt.plan.targets) {
      stage = `environment read: ${target.name}`;
      const current = await readEnvironment(target.id);
      if (settingsCommitment(current) === target.afterCommitment) continue;
      stage = `durable intent: ${target.name}`;
      await checkpoint({ ...receipt, pending: `settings:${target.id}` });
      stage = `environment write: ${target.name}`;
      const merged = mergeEnvironment(current, receipt.plan.settings);

      const reply = await mgmt(target.id).update_settings({ canister_id: pid(target.id),
        settings: { environment_variables: [merged] } });
      if (reply && typeof reply === 'object' && 'Err' in reply) throw new Error('Service refused the environment write');
      stage = `environment readback: ${target.name}`;
      if (settingsCommitment(await readEnvironment(target.id)) !== target.afterCommitment)
        throw new Error(`${target.name} settings did not read back as planned`);
    }
    const applied = { ...receipt, pending: null, phase: 'settings-applied' };
    await checkpoint(applied);
    const message = `### PROD member access settings applied\n\nAll ${receipt.plan.targets.length} reader services now carry the reviewed account service and admission enabled, each read back after writing. Global removal and rehearsal were never written.\nCommission ordinary member access next; nothing is usable until then.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  if (action === 'commission') {
    if (receipt.phase !== 'settings-applied') throw new Error('Member-access settings have not been applied yet');
    if (receipt.pending) throw new Error('Unresolved member-access intent; review the receipt before commissioning');

    stage = 'durable intent: commissioning';
    await checkpoint({ ...receipt, pending: 'commission' });
    const binding = receipt.plan.binding;
    stage = 'account service member access commissioning';
    const reply = await actor(commissionService, ids.identity_access).authorize_production_member_access({
      registry: pid(binding.registry), registry_revision: BigInt(binding.registry_revision),
      target_alias: binding.target_alias, deployment_id: binding.deployment_id,
      deployment_revision: BigInt(binding.deployment_revision), host: binding.host,
      network_kind: binding.network_kind });
    if ('Err' in reply) throw new Error('Account service refused the member access commissioning request');
    stage = 'readback after commissioning';
    const verified = assertMemberAccessReadback({ identityConfig: await readIdentityConfig(),
      environments: await readEnvironments(receipt.plan.targets), page: await readRegistryPage() }, receipt.plan);
    await checkpoint({ ...receipt, pending: null, phase: 'commissioned', verified });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-member-access-result.json'), evidenceText(verified));
    const message = `### PROD member access commissioned\n\nOrdinary member access is live on all ${verified.readers} reader services; global account removal, erasure and recovery remain deferred and both groups stay CLOSED.\nRouting approval and opening are separate gates and were not touched.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  stage = 'read-only readback (no writes)';
  const state = await input();
  const verified = assertMemberAccessReadback({ identityConfig: state.identityConfig,
    environments: state.environments, page: state.page }, receipt.plan);
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-member-access-result.json'), evidenceText(verified));
  const message = `### PROD member access readback confirmed\n\n${JSON.stringify(verified)}\nNothing was written by this pass.\n`;
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try { await main(); } catch (error) {
    saveMemberAccessFailure(process.env, error, stage);
    process.exitCode = 1;
  }
}
