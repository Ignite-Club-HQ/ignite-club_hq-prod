// PROD-only account-service lifecycle link runner. Reads the live router and
// identity canister state, then either records a reviewable plan or applies a
// previously reviewed one: environment release, router deletion authority,
// identity registry pin. Every stage is journalled and read back.
import fs from 'node:fs';
import path from 'node:path';
import { Actor, HttpAgent, Principal } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { identityFromPem } from './ic-identity.mjs';
import { githubJournal } from './github-journal.mjs';
import { ensureIsolatedIcSdk } from './ensure-ic-sdk.mjs';
import { groupContract, variantReaderService } from './prod-group-contract.mjs';
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { RECEIPT_PATH } from './prod-base-group-policy.mjs';
import { G2_RECEIPT_PATH } from './prod-g2-create-policy.mjs';
import { G2_REGISTRATION_RECEIPT_PATH } from './prod-g2-register-policy.mjs';
import {
  IDENTITY_LINK_RECEIPT_PATH, assertIdentityLinkContext, buildIdentityLinkPlan,
  assertReviewedIdentityLinkPlan, linkAccountService, reconcileIdentityLinkReadback,
  readState, mergeEnvironment, identityLinkSummary, BOUND_DELETION_RELEASE_ENV,
} from './prod-identity-link-policy.mjs';

const ids = JSON.parse(fs.readFileSync(path.join(process.env.CHECK_DEPS_DIR, 'deploy/prod/identity/ic.ids.json'), 'utf8'));
const principal = process.env.PROD_GOVERNOR_PRINCIPAL?.trim();
const action = process.env.LINK_ACTION;
const reviewedHash = process.env.LINK_PLAN_HASH;
const confirmation = process.env.CONFIRMATION;
const deps = ensureIsolatedIcSdk();
assertIdentityLinkContext(ids, process.env, principal, action);

const agent = new HttpAgent({ host: 'https://icp-api.io', identity: identityFromPem(process.env.CHECK_KEY_PEM) });
const serviceFactory = IDL => ({ IDL, service: IDL.Service({ read_group_opening_configuration: IDL.Func([], [variantReaderService(IDL, 'vec', IDL.Tuple(IDL.Text, IDL.Text))], []) }) });
const readerService = IDL => IDL.Service({
  read_group_registry_page: IDL.Func([IDL.Text, IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Text), IDL.Nat32],
    [IDL.Variant({ Ok: IDL.Record({
      revision: IDL.Nat64,
      groups: IDL.Vec(IDL.Record({ id: IDL.Text, target_alias: IDL.Text, domains: IDL.Vec(IDL.Record({
        domain: IDL.Text, canister: IDL.Principal, deployment_id: IDL.Text, deployment_revision: IDL.Text,
        host: IDL.Text, network_kind: IDL.Text, additional_subnets_enabled: IDL.Bool })),
      photo_store: IDL.Vec(IDL.Principal), accepting: IDL.Bool, max_clubs: IDL.Nat32,
      min_cycles: IDL.Nat64, heap_bytes: IDL.Nat64, cycles: IDL.Nat64, observed_at_ns: IDL.Nat64 })),
      placements: IDL.Vec(IDL.Record({
        group_id: IDL.Text, deployment_id: IDL.Text, deployment_revision: IDL.Text, host: IDL.Text,
        network_kind: IDL.Text, primary_subnet: IDL.Principal, approved_subnets: IDL.Vec(IDL.Principal),
        additional_subnets_enabled: IDL.Bool,
        domains: IDL.Vec(IDL.Record({ domain: IDL.Text, canister: IDL.Principal, subnet: IDL.Principal })) })),
      next_cursor: IDL.Opt(IDL.Text), configuration_revision: IDL.Opt(IDL.Nat64) })), Err: IDL.Text })], []),
});
const authorityService = IDL => IDL.Service({
  set_deletion_authority: IDL.Func([IDL.Principal], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
});
const pinService = IDL => {
  const binding = IDL.Record({
    registry: IDL.Principal, registry_revision: IDL.Nat64, target_alias: IDL.Text, deployment_id: IDL.Text,
    deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text,
  });
  return IDL.Service({
    pin_owner_test_deletion_registry: IDL.Func([binding], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  });
};
const managementService = IDL => {
  const environment = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
  return () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
      settings: IDL.Record({ environment_variables: IDL.Opt(environment) }),
    })], []),
    update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal, settings: IDL.Record({
      environment_variables: IDL.Opt(environment) }) })], [], []),
  });
};

const options = canisterId => ({ agent, canisterId, effectiveCanisterId: canisterId });
const mgmt = () => Actor.createActor(managementService(IDL), { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: ids.identity_access });
const registryPage = async () => {
  const reply = await Actor.createActor(() => readerService(IDL), options(ids.shard_router))
    .read_group_registry_page('mainnet', [], [], 64);
  if ('Err' in reply) throw new Error('Router refused the bounded registry read');
  return reply.Ok;
};
const openingConfiguration = canisterId => Actor.createActor(() => serviceFactory(IDL).service, options(canisterId))
  .read_group_opening_configuration();
const routerConfiguration = async () => {
  const reply = await openingConfiguration(ids.shard_router);
  if ('Err' in reply) throw new Error('Router refused the governor-only configuration read');
  return reply.Ok;
};
// Unpinned identity canisters answer with this refusal; every other refusal is a
// real stop, never silently treated as "not pinned yet".
const identityConfiguration = async () => {
  const reply = await openingConfiguration(ids.identity_access);
  if ('Err' in reply) {
    if (reply.Err === 'Deletion registry not pinned') return null;
    throw new Error('Account service refused the governor-only configuration read');
  }
  return reply.Ok;
};
const identityEnvironment = async () => {
  const status = await mgmt().canister_status({ canister_id: Principal.fromText(ids.identity_access) });
  return status.settings?.environment_variables?.[0] ?? [];
};

const journals = {
  base: githubJournal({ branch: 'prod-group-setup-receipts', path: RECEIPT_PATH, label: 'base group' }),
  g2: githubJournal({ branch: 'prod-group-setup-receipts', path: G2_RECEIPT_PATH, label: 'g2 creation' }),
  g2Registration: githubJournal({ branch: 'prod-group-setup-receipts', path: G2_REGISTRATION_RECEIPT_PATH, label: 'g2 registration' }),
  link: githubJournal({ branch: 'prod-group-setup-receipts', path: IDENTITY_LINK_RECEIPT_PATH, label: 'account-service link' }),
};
const input = async () => {
  const page = await registryPage();
  return { ids, env: process.env, principal, baseReceipt: await journals.base.load(),
    g2Receipt: await journals.g2Registration.load(), page, routerConfig: await routerConfiguration(),
    identityConfig: await identityConfiguration(), identityEnv: await identityEnvironment(),
    checkedAt: new Date().toISOString() };
};
const capture = async name => {
  const reportDir = process.env.CHECK_REPORT_DIR;
  if (!reportDir) return;
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, `${name}.json`), JSON.stringify(await (async () => ({
    routerConfig: await routerConfiguration(), identityConfig: await identityConfiguration(),
    identityEnv: await identityEnvironment(), page: await registryPage(),
  }))(), null, 2));
};
const state = () => readState({ readRouterConfig: routerConfiguration, readIdentityConfig: identityConfiguration,
  readEnvironment: identityEnvironment, readRegistryPage: registryPage }, null);

let outcome;
try {
  if (action === 'inspect') {
    const current = await journals.link.load();
    if (!current) throw new Error('No account-service link receipt exists yet; run plan first');
    outcome = { phase: current.phase, pending: current.pending, planHash: current.planHash };
  } else if (action === 'plan') {
    const current = await journals.link.load();
    if (current) throw new Error('An account-service link receipt already exists; use reconcile-readback');
    const plan = buildIdentityLinkPlan(await input());
    await journals.link.checkpoint({ version: 1, phase: 'planned', pending: null, planHash: planHash(plan), plan });
    await capture('plan');
    outcome = plan;
  } else if (action === 'link') {
    const receipt = await journals.link.load();
    const current = await input();
    assertReviewedIdentityLinkPlan(receipt?.plan, reviewedHash, buildIdentityLinkPlan({ ...current,
      checkedAt: receipt?.plan?.checkedAt ?? current.checkedAt }));
    const verified = await linkAccountService({
      plan: receipt.plan, receipt, checkpoint: journals.link.checkpoint,
      setEnvironment: async plan => {
        const merged = mergeEnvironment(await identityEnvironment(), [plan.environment]);
        await mgmt().update_settings({ canister_id: Principal.fromText(plan.identityAccess),
          settings: { environment_variables: [merged] } });
      },
      readEnvironment: identityEnvironment,
      setDeletionAuthority: async plan => {
        const reply = await Actor.createActor(() => authorityService(IDL), options(ids.shard_router))
          .set_deletion_authority(Principal.fromText(plan.identityAccess));
        if ('Err' in reply) throw new Error('Router refused the deletion authority bind');
      },
      readRouterConfig: routerConfiguration,
      pinRegistry: async plan => {
        const binding = plan.binding;
        const reply = await Actor.createActor(() => pinService(IDL), options(ids.identity_access))
          .pin_owner_test_deletion_registry({ registry: Principal.fromText(binding.registry),
            registry_revision: BigInt(binding.registryRevision), target_alias: binding.targetAlias,
            deployment_id: binding.deploymentId, deployment_revision: BigInt(binding.deploymentRevision),
            host: binding.host, network_kind: binding.networkKind });
        if ('Err' in reply) throw new Error('Account service refused the registry pin');
      },
      readIdentityConfig: identityConfiguration,
      readRegistryPage: registryPage,
    });
    await capture('linked');
    outcome = { linked: true, verified };
  } else if (action === 'reconcile-readback') {
    const receipt = await journals.link.load();
    const verified = await reconcileIdentityLinkReadback({ receipt, expectedHash: reviewedHash,
      readState: plan => readState({ readRouterConfig: routerConfiguration, readIdentityConfig: identityConfiguration,
        readEnvironment: identityEnvironment, readRegistryPage: registryPage }, plan),
      checkpoint: journals.link.checkpoint });
    if (verified.completed) await capture('reconciled');
    outcome = verified;
  }

  const summary = [
    action === 'plan' ? `PROD account-service link planned; reviewed hash ${planHash(outcome)}.` :
      action === 'inspect' ? `PROD account-service link receipt phase ${outcome.phase}.` :
        action === 'reconcile-readback' ? `PROD account-service link reconciliation completed: ${JSON.stringify(outcome)}.` :
          `PROD account service linked and read back: ${JSON.stringify(outcome.verified)}.`,
    ...(action === 'plan' ? ['Nothing was written. Nothing was charged. Re-run with the exact reviewed hash.'] : []),
    ...(action === 'plan' ? ['Routing approval, group opening and admission remain separate gates.'] : []),
    ...(action === 'plan' ? identityLinkSummary(outcome) : []),
  ].filter(Boolean);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## PROD account service link\n\n${summary.map(line => `- ${line}`).join('\n')}\n`);
  console.log(JSON.stringify(outcome, null, 2));
} catch (error) {
  await saveIdentityLinkFailure(error);
  throw error;
}

const planHash = plan => {
  // Imported lazily so the failure path below never depends on hashing helpers.
  return hashPlanOf(plan);
};
async function saveIdentityLinkFailure(error) {
  const reportDir = process.env.CHECK_REPORT_DIR;
  if (!reportDir) return;
  fs.mkdirSync(reportDir, { recursive: true });
  const text = error?.message ? String(error.message) : 'Unknown failure';
  const reason = identityLinkFailureReason(text);
  fs.writeFileSync(path.join(reportDir, 'failure.json'), JSON.stringify({
    action, reviewed: Boolean(reviewedHash), reason,
    detail: text.slice(0, 240).replace(/[\r\n]+/g, ' '),
  }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## PROD account service link stopped\n\n- Action: ${action}\n- Reason: ${reason}\n`);
}
export function identityLinkFailureReason(text) {
  const known = [
    /Exact confirmation required/, /Only plan/, /live repository/, /prod branch/, /exact recorded/,
    /confirmed closed .* receipt required/i, /reviewed closed/i, /exactly two registered groups/i,
    /must stay CLOSED/i, /differs from its reviewed receipt/i, /reviewed public-mainnet PROD deployment/i,
    /exactly one approved subnet/i, /share one target alias/i,
    /already bound to another principal/i, /already pinned to a different registry/i,
    /is set to .*review before linking/i, /must stay disabled on PROD/i,
    /Reviewed plan hash/i, /does not match the saved/i, /changed; re-plan/i, /Closed-only/i,
    /Unresolved account-service intent/i, /readback failed/i, /did not read back as released/i,
    /must remain disabled after linking/i, /Registry inventory changed/i,
    /refused the governor-only configuration read/i, /refused the bounded registry read/i,
    /refused the deletion authority bind/i, /refused the registry pin/i,
    /receipt already exists/i, /No account-service link receipt/i, /not awaiting reconciliation/i,
    /readback-only pass/i, /Required for reconciliation/i,
  ];
  return known.some(pattern => pattern.test(text)) ? text.slice(0, 240).replace(/[\r\n]+/g, ' ') :
    'Account-service link stopped before completing; review the exact workflow log before retrying';
}
function hashPlanOf(plan) {
  const { hashPlan } = deps.require('@dfinity/agent') ? {} : {};
  return canonicalHash(plan);
}
async function canonicalHash(value) {
  const { canonical, hashPlan } = await import('./prod-base-group-policy.mjs');
  void canonical;
  return hashPlan(value);
}
