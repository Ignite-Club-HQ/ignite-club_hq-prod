// PROD-only account-service lifecycle link runner. Reads the live router and
// identity canister state, then either records a reviewable plan or applies a
// previously reviewed one: environment release, router deletion authority,
// identity registry pin. Every stage is journalled and read back before the
// next one, so an interrupted run leaves a receipt naming the last proved stage.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { evidenceText } from './prod-connection-check-policy.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { G2_RECEIPT_PATH } from './prod-g2-create-policy.mjs';
import { G2_REGISTRATION_RECEIPT_PATH } from './prod-g2-register-policy.mjs';
import {
  IDENTITY_LINK_RECEIPT_PATH, assertIdentityLinkContext, buildIdentityLinkPlan,
  assertReviewedIdentityLinkPlan, linkAccountService, reconcileIdentityLinkReadback,
  restoreBoundDeletionRelease, readState, mergeEnvironment, identityLinkSummary,
} from './prod-identity-link-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let stage = 'startup';
const KNOWN_FAILURES = [
  'Only plan, inspect, link, reconcile-readback or restore-release supported',
  'Exact confirmation required: LINK PROD ACCOUNT SERVICE',
  'Exact confirmation required: CONFIRM PROD ACCOUNT SERVICE READBACK',
  'Exact confirmation required: RESTORE PROD BOUND DELETION RELEASE',
  'Completed reviewed account-service link receipt required for release restore',
  'Router deletion authority differs from the reviewed link; stop and review',
  'Account-service registry pin differs from the reviewed link; stop and review',
  'Registry inventory changed since the reviewed link; stop and review',
  'Connection check requires the live repository prod branch',
  'Connection check requires the exact recorded 18-service PROD inventory',
  'Confirmed closed base and g2 registration receipts required',
  'Reviewed closed-group receipts required',
  'Exactly two registered groups required before linking the account service',
  'The registry must hold exactly the reviewed base and g2 groups',
  'group must stay CLOSED before linking the account service',
  'group inventory differs from its reviewed receipt',
  'must be the reviewed public-mainnet PROD deployment',
  'must have exactly one approved subnet',
  'Groups must share one target alias',
  'Router deletion authority is already bound to another principal; stop and review',
  'Account service is already pinned to a different registry or deployment; stop and review',
  'review before linking',
  'must stay disabled on PROD',
  'Reviewed plan hash required (64 lowercase hex characters)',
  'Reviewed plan hash does not match the saved account-service link receipt',
  'changed; re-plan before linking',
  'Closed-only account-service link required',
  'Unresolved account-service intent; reconcile without replay',
  'Reviewed account-service link receipt required',
  'Account-service environment readback failed',
  'Router deletion authority readback failed',
  'Account-service registry pin readback failed',
  'Bound-deletion protocol did not read back as released',
  'Account admission must remain disabled after linking',
  'Rehearsal must remain disabled after linking',
  'Registry inventory changed during the account-service link',
  'Router refused the bounded registry read',
  'Router refused the governor-only configuration read',
  'Account service refused the governor-only configuration read',
  'Router refused the deletion authority bind',
  'Account service refused the registry pin',
  'Account service refused the environment write',
  'An account-service link receipt already exists; use reconcile-readback',
  'No account-service link receipt exists yet; run plan first',
  'Reviewed account-service link receipt required for reconciliation',
  'Account-service link is not awaiting reconciliation',
  'must be reconciled by a fresh reviewed run, not a readback-only pass',
];

/**
 * A known refusal is quoted; anything else is replaced by a fixed sentence. A
 * provider or transport error can echo an argument, so principal-shaped tokens
 * are redacted from every reason before it reaches the workflow log or artifact.
 */
export function identityLinkFailureReason(text) {
  const message = String(text ?? '').slice(0, 240).replace(/[\r\n]+/g, ' ')
    .replace(/\b[a-z0-9]{5}(-[a-z0-9]{5})+\b/g, '[principal]');
  return KNOWN_FAILURES.some(known => message.includes(known)) ? message :
    'Account-service link stopped before completing; review the exact workflow log and receipt before retrying';
}

export function saveIdentityLinkFailure(env, error, failedStage) {
  const report = { status: 'stopped', stage: failedStage, reason: identityLinkFailureReason(error?.message),
    action: env.LINK_ACTION ?? null, retryAuthorized: false };
  const message = `### PROD account-service link stopped\n\nStage: ${report.stage}\n\nReason: ${report.reason}\n\nDo not retry the link until the durable receipt is reviewed.\n`;
  console.error(message);
  if (env.CHECK_REPORT_DIR) {
    mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-failure.json'), evidenceText(report));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
  return report;
}

async function main() {
  const env = process.env, action = env.LINK_ACTION;
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
  assertIdentityLinkContext(ids, env, principal, action);

  stage = 'live router and account service readback';
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const contract = groupContract(IDL);
  const Pairs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const Result = ok => IDL.Variant({ Ok: ok, Err: IDL.Text });
  const configReader = () => IDL.Service({ read_group_opening_configuration: IDL.Func([], [Result(Pairs)], []) });
  const authorityService = () => IDL.Service({ set_deletion_authority: IDL.Func([IDL.Principal], [Result(IDL.Null)], []) });
  const pinService = () => IDL.Service({
    pin_owner_test_deletion_registry: IDL.Func([IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64,
      target_alias: IDL.Text, deployment_id: IDL.Text, deployment_revision: IDL.Nat64, host: IDL.Text,
      network_kind: IDL.Text })], [Result(IDL.Null)], []),
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

  const readRegistryPage = async () => JSON.parse(evidenceText(unwrap(await actor(contract.reader, ids.shard_router)
    .read_group_registry_page('mainnet', [], [], 64))));
  const readRouterConfig = async () => {
    const reply = await actor(configReader, ids.shard_router).read_group_opening_configuration();
    if ('Err' in reply) throw new Error('Router refused the governor-only configuration read');
    return reply.Ok;
  };
  // An unpinned identity canister answers with this exact refusal; every other
  // refusal is a real stop, never silently read as "not pinned yet".
  const readIdentityConfig = async () => {
    const reply = await actor(configReader, ids.identity_access).read_group_opening_configuration();
    if ('Err' in reply) {
      if (reply.Err === 'Deletion registry not pinned') return null;
      throw new Error('Account service refused the governor-only configuration read');
    }
    return reply.Ok;
  };
  const readIdentityEnv = async () => unwrapEnvironment(await mgmt(ids.identity_access)
    .canister_status({ canister_id: pid(ids.identity_access) }));
  const unwrapEnvironment = status => {
    const rows = status?.settings?.environment_variables;
    if (rows === undefined || rows === null || (Array.isArray(rows) && rows.length === 0)) return [];
    const list = Array.isArray(rows) ? rows[0] : rows;
    if (!Array.isArray(list)) throw new Error('Account service refused the environment read');
    return list.map(({ name, value }) => ({ name, value }));
  };

  stage = 'load durable receipts';
  const baseJournal = githubJournal(env);
  const creationJournal = githubJournal(env, fetch, { path: G2_RECEIPT_PATH, label: 'g2 creation' });
  const registrationJournal = githubJournal(env, fetch, { path: G2_REGISTRATION_RECEIPT_PATH, label: 'g2 registration' });
  const journal = githubJournal(env, fetch, { path: IDENTITY_LINK_RECEIPT_PATH, label: 'account-service link' });
  const receiptPath = () => path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-receipt.json');
  const checkpoint = async receipt => {
    stage = `durable checkpoint: ${receipt.pending ?? receipt.phase}`;
    await journal.save(receipt);
    writeFileSync(receiptPath(), evidenceText(receipt));
    stage = `after acknowledged checkpoint: ${receipt.pending ?? receipt.phase}`;
  };
  const capture = async name => {
    const state = await readState({ readRouterConfig, readIdentityConfig, readEnvironment: readIdentityEnv,
      readRegistryPage }, { identityAccess: ids.identity_access });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, `prod-identity-link-${name}.json`), evidenceText(state));
  };
  const input = async checkedAt => ({ ids, env, principal, baseReceipt: await baseJournal.load({ readOnly: true }),
    g2Receipt: await registrationJournal.load({ readOnly: true }), page: await readRegistryPage(),
    routerConfig: await readRouterConfig(), identityConfig: await readIdentityConfig(),
    identityEnv: await readIdentityEnv(), checkedAt: checkedAt ?? new Date().toISOString() });

  if (action === 'inspect') {
    stage = 'read-only inspection (no writes)';
    const receipt = await journal.load({ readOnly: true });
    const state = await readState({ readRouterConfig, readIdentityConfig, readEnvironment: readIdentityEnv,
      readRegistryPage }, { identityAccess: ids.identity_access });
    const report = { receiptPhase: receipt?.phase ?? 'missing', pending: receipt?.pending ?? null,
      savedSourceCommit: receipt?.plan?.sourceCommit ?? null, currentSourceCommit: env.GITHUB_SHA,
      sourceChanged: receipt?.plan?.sourceCommit !== env.GITHUB_SHA,
      basePhase: (await baseJournal.load({ readOnly: true }))?.phase ?? 'missing',
      registrationPhase: (await registrationJournal.load({ readOnly: true }))?.phase ?? 'missing',
      environmentReleased: state.identityEnv.some(e => e.name === 'IGNITE_BOUND_DELETION_RELEASE' && e.value === '1'),
      routerAuthority: state.routerConfig.find(([k]) => k === 'deletion_authority')?.[1] ?? 'unset',
      registryPinned: state.identityConfig !== null,
      registryGroups: state.page.groups.map(g => `${g.id}:${g.accepting ? 'OPEN' : 'CLOSED'}`),
      openingAuthorized: false, admissionAuthorized: false };
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-inspection.json'), evidenceText(report));
    const message = `### PROD account-service link read-only inspection\n\nLink receipt: ${report.receiptPhase}; pending: ${report.pending ?? 'none'}.\nBase receipt: ${report.basePhase}; g2 registration receipt: ${report.registrationPhase}.\nRouter deletion authority: ${report.routerAuthority}.\nAccount service registry pinned: ${report.registryPinned ? 'yes' : 'no'}.\nBound-deletion release environment: ${report.environmentReleased ? 'present' : 'absent'}.\nGroups: ${report.registryGroups.join(', ')}.\nNo environment write, authority bind, registry pin, approval or opening. Review evidence before linking.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  if (action === 'plan') {
    stage = 'build current closed-only link plan';
    if (await journal.load({ readOnly: true }))
      throw new Error('An account-service link receipt already exists; use reconcile-readback');
    const plan = buildIdentityLinkPlan(await input());
    const planned = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan };
    await checkpoint(planned);
    await capture('plan');
    const message = `### PROD account-service link plan\n\nReviewed-plan hash: \`${planned.planHash}\`\n\nThree effects, each read back before the next: set \`${plan.environment.name}=${plan.environment.value}\` on ${plan.identityAccess}; bind the router's deletion authority to it; pin its trusted registry to ${plan.binding.registry} at revision ${plan.binding.registryRevision}.\nBoth groups stay CLOSED. No routing approval, opening, admission, rehearsal, group registration, funding, DEV or database change.\nPlan persisted; inspect before linking.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  if (action === 'reconcile-readback') {
    stage = 'reconcile pending readback (no lifecycle writes)';
    const receipt = await journal.load({ readOnly: true });
    const verified = await reconcileIdentityLinkReadback({ receipt, expectedHash: env.LINK_PLAN_HASH,
      readState: plan => readState({ readRouterConfig, readIdentityConfig, readEnvironment: readIdentityEnv,
        readRegistryPage }, plan), checkpoint });
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-result.json'), evidenceText(verified));
    const message = `### PROD account-service link reconciliation completed\n\n${JSON.stringify(verified.verified ?? verified)}\nNo environment write, authority bind or registry pin was repeated. Routing approval, opening and admission remain separate.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  if (action === 'restore-release') {
    stage = 'restore bound-deletion release after upgrade (no authority or pin writes)';
    const receipt = await journal.load({ readOnly: true });
    const result = await restoreBoundDeletionRelease({ receipt, expectedHash: env.LINK_PLAN_HASH,
      readState: plan => readState({ readRouterConfig, readIdentityConfig, readEnvironment: readIdentityEnv,
        readRegistryPage }, plan),
      setEnvironment: async plan => {
        stage = 'environment write: bound-deletion release restore';
        const merged = mergeEnvironment(await readIdentityEnv(), [plan.environment]);
        const reply = await mgmt(plan.identityAccess).update_settings({ canister_id: pid(plan.identityAccess),
          settings: { environment_variables: [merged] } });
        if (reply && typeof reply === 'object' && 'Err' in reply)
          throw new Error('Account service refused the environment write');
      },
      checkpoint });
    await capture('restore-release');
    writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-result.json'), evidenceText(result));
    const message = `### PROD bound-deletion release restored\n\nEnvironment write: ${result.restored ? 'applied and read back' : 'not needed (already present)'}.\n${JSON.stringify(result.verified)}\nNo authority bind, registry pin, routing approval, opening or admission.\n`;
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message);
    return;
  }

  stage = 'verify reviewed plan against current source and infrastructure';
  const receipt = await journal.load({ readOnly: true });
  if (!receipt) throw new Error('No account-service link receipt exists yet; run plan first');
  assertReviewedIdentityLinkPlan(receipt.plan, env.LINK_PLAN_HASH, buildIdentityLinkPlan(await input(
    receipt.plan.checkedAt)));
  const verified = await linkAccountService({
    plan: receipt.plan, receipt, checkpoint,
    setEnvironment: async plan => {
      stage = 'environment write: bound-deletion release';
      const merged = mergeEnvironment(await readIdentityEnv(), [plan.environment]);
      const reply = await mgmt(plan.identityAccess).update_settings({ canister_id: pid(plan.identityAccess),
        settings: { environment_variables: [merged] } });
      if (reply && typeof reply === 'object' && 'Err' in reply) throw new Error('Account service refused the environment write');
    },
    readEnvironment: readIdentityEnv,
    setDeletionAuthority: async plan => {
      stage = 'router deletion authority bind';
      const reply = await actor(authorityService, ids.shard_router)
        .set_deletion_authority(pid(plan.identityAccess));
      if ('Err' in reply) throw new Error('Router refused the deletion authority bind');
    },
    readRouterConfig,
    pinRegistry: async plan => {
      stage = 'account service registry pin';
      const binding = plan.binding;
      const reply = await actor(pinService, ids.identity_access).pin_owner_test_deletion_registry({
        registry: pid(binding.registry), registry_revision: BigInt(binding.registryRevision),
        target_alias: binding.targetAlias, deployment_id: binding.deploymentId,
        deployment_revision: BigInt(binding.deploymentRevision), host: binding.host,
        network_kind: binding.networkKind });
      if ('Err' in reply) throw new Error('Account service refused the registry pin');
    },
    readIdentityConfig,
    readRegistryPage,
  });
  await capture('linked');
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-identity-link-result.json'), evidenceText(verified));
  const message = identityLinkSummary(receipt.plan, verified).map(line => `- ${line}`).join('\n');
  console.log(`PROD account service linked and independently read back. Routing approval, opening and admission remain separate gates.`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## PROD account service link\n\n${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  saveIdentityLinkFailure(process.env, error, stage);
  process.exitCode = 1;
});
