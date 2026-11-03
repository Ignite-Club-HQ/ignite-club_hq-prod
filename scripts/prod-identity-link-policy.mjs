// Pure policy for linking the PROD account service (identity_access) into the
// reviewed closed router deployment. Three effects, in this order:
//   1. release the bound-deletion protocol on the identity canister,
//   2. bind the router's deletion authority to that identity canister,
//   3. pin the identity canister's trusted deletion registry to that router.
// It never registers or opens a group, never records a routing approval, never
// enables admission or rehearsal, and never touches DEV or the database.
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { canonical, hashPlan, normalizeReviewedHash } from './prod-base-group-policy.mjs';

export const IDENTITY_LINK_RECEIPT_PATH = 'prod-group-setup/identity-link.json';
export const IDENTITY_LINK_CONFIRMATION = 'LINK PROD ACCOUNT SERVICE';
export const IDENTITY_LINK_READBACK_CONFIRMATION = 'CONFIRM PROD ACCOUNT SERVICE READBACK';
export const IDENTITY_LINK_RESTORE_CONFIRMATION = 'RESTORE PROD BOUND DELETION RELEASE';
export const BOUND_DELETION_RELEASE_ENV = 'IGNITE_BOUND_DELETION_RELEASE';
export const REHEARSAL_ENV = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export const LINK_HOST = 'https://icp-api.io';
export const LINK_NETWORK_KIND = 'public_mainnet';

export function assertIdentityLinkContext(ids, env, principal, action) {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'inspect', 'link', 'reconcile-readback', 'restore-release'].includes(action))
    throw new Error('Only plan, inspect, link, reconcile-readback or restore-release supported');
  if (action === 'link' && env.CONFIRMATION?.trim() !== IDENTITY_LINK_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${IDENTITY_LINK_CONFIRMATION}`);
  if (action === 'reconcile-readback' && env.CONFIRMATION?.trim() !== IDENTITY_LINK_READBACK_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${IDENTITY_LINK_READBACK_CONFIRMATION}`);
  if (action === 'restore-release' && env.CONFIRMATION?.trim() !== IDENTITY_LINK_RESTORE_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${IDENTITY_LINK_RESTORE_CONFIRMATION}`);
}

const decimal = (value, label) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`Invalid ${label}`);
  return BigInt(value);
};
const immutableGroup = g => {
  const { heap_bytes, cycles, observed_at_ns, ...configuration } = g;
  return configuration;
};
const immutablePlacement = p => {
  const { heap_bytes, cycles, observed_at_ns, ...configuration } = p;
  return configuration;
};
export const rowsToMap = rows => Object.fromEntries((rows ?? []).map(([key, value]) => [key, value]));
export const envValue = (env, name) => (env ?? []).find(e => e?.name === name)?.value;

/**
 * Merge a patch into a canister's environment without dropping anything.
 * `update_settings` replaces the whole list, so a blind write could delete an
 * unrelated variable (a vetkey name, a governor id). Same-value entries are
 * left untouched so a replay is a no-op.
 */
export function mergeEnvironment(current, patch) {
  const byName = new Map();
  for (const entry of current ?? []) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.value !== 'string')
      throw new Error('Invalid current environment entry');
    byName.set(entry.name, entry.value);
  }
  for (const entry of patch ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(entry?.name ?? '')) throw new Error('Invalid environment variable name');
    if (typeof entry.value !== 'string') throw new Error('Invalid environment variable value');
    byName.set(entry.name, entry.value);
  }
  return [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, value]) => ({ name, value }));
}

/**
 * The reviewed plan. `page` is the live registry, `routerConfig`/`identityConfig`
 * are the governor-only opening-configuration rows (null when the identity
 * registry is not pinned yet), `identityEnv` is the identity canister's live
 * environment. Both groups must already be registered CLOSED and match the two
 * reviewed receipts, so this gate can never pin an unreviewed inventory.
 */
export function buildIdentityLinkPlan({ ids, env, principal, baseReceipt, g2Receipt, page,
  routerConfig, identityConfig, identityEnv, checkedAt }) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Exact source commit required');
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  if (!baseReceipt || baseReceipt.phase !== 'registered-closed' || baseReceipt.pending ||
      !g2Receipt || g2Receipt.phase !== 'registered-closed' || g2Receipt.pending)
    throw new Error('Confirmed closed base and g2 registration receipts required');
  if (hashPlan(baseReceipt.plan) !== baseReceipt.planHash || hashPlan(g2Receipt.plan) !== g2Receipt.planHash)
    throw new Error('Reviewed closed-group receipts required');
  if (page.next_cursor?.length || !Array.isArray(page.groups) || !Array.isArray(page.placements) ||
      page.groups.length !== 2 || page.placements.length !== 2)
    throw new Error('Exactly two registered groups required before linking the account service');

  const reviewed = { base: baseReceipt.plan, g2: g2Receipt.plan };
  const byId = new Map(page.groups.map(g => [g.id, g]));
  const placements = new Map(page.placements.map(p => [p.group_id, p]));
  const groupIds = [...byId.keys()].sort();
  if (byId.size !== 2 || placements.size !== 2 || JSON.stringify(groupIds) !== JSON.stringify(['base', 'g2']))
    throw new Error('The registry must hold exactly the reviewed base and g2 groups');
  for (const [id, group] of byId) {
    if (group.accepting !== false) throw new Error(`${id} group must stay CLOSED before linking the account service`);
    const placement = placements.get(id);
    if (!placement) throw new Error(`${id} group has no reviewed placement`);
    if (placement.deployment_id !== 'prod' || placement.host !== LINK_HOST ||
        placement.network_kind !== LINK_NETWORK_KIND || placement.additional_subnets_enabled)
      throw new Error(`${id} placement must be the reviewed public-mainnet PROD deployment`);
    if (placement.approved_subnets?.length !== 1 || placement.approved_subnets[0] !== placement.primary_subnet)
      throw new Error(`${id} placement must have exactly one approved subnet`);
    if (canonical(immutableGroup(group)) !== canonical(immutableGroup(reviewed[id].group)) ||
        canonical(immutablePlacement(placement)) !== canonical(immutablePlacement(reviewed[id].placement)))
      throw new Error(`${id} group inventory differs from its reviewed receipt`);
  }
  const targetAliases = new Set(page.groups.map(g => g.target_alias));
  if (targetAliases.size !== 1) throw new Error('Groups must share one target alias');
  const [targetAlias] = [...targetAliases];

  const revision = decimal(page.revision, 'registry revision').toString();
  const configurationRevision = decimal(page.configuration_revision?.[0], 'configuration revision').toString();
  const binding = {
    registry: ids.shard_router,
    registryRevision: revision,
    targetAlias,
    deploymentId: 'prod',
    deploymentRevision: '1',
    host: LINK_HOST,
    networkKind: LINK_NETWORK_KIND,
  };

  const authority = rowsToMap(routerConfig).deletion_authority ?? '';
  if (authority && authority !== ids.identity_access)
    throw new Error('Router deletion authority is already bound to another principal; stop and review');
  const pinned = identityConfig === null;
  if (!pinned && !bindingMatchesRows(binding, identityConfig))
    throw new Error('Account service is already pinned to a different registry or deployment; stop and review');
  const release = envValue(identityEnv, BOUND_DELETION_RELEASE_ENV);
  if (release !== undefined && release !== '1')
    throw new Error(`${BOUND_DELETION_RELEASE_ENV} is set to "${release}"; review before linking`);
  const rehearsal = envValue(identityEnv, REHEARSAL_ENV);
  if (rehearsal !== undefined && rehearsal !== '0')
    throw new Error(`${REHEARSAL_ENV} must stay disabled on PROD`);

  return {
    version: 1,
    purpose: 'Link the PROD account service to the reviewed closed router deployment',
    sourceCommit: env.GITHUB_SHA,
    checkedAt,
    principal,
    identityAccess: ids.identity_access,
    routerId: ids.shard_router,
    registryRevision: revision,
    configurationRevision,
    groups: groupIds,
    binding,
    environment: { name: BOUND_DELETION_RELEASE_ENV, value: '1' },
    deletionReleaseRequired: release !== '1',
    routerAuthorityRequired: !authority,
    registryPinRequired: pinned || !bindingMatchesRows(binding, identityConfig),
    executable: false,
    openingAuthorized: false,
    admissionAuthorized: false,
    groupRegistrationAuthorized: false,
    routingApprovalAuthorized: false,
    rehearsalReleaseAuthorized: false,
  };
}

/** Clock and balance must never change a reviewed hash, but real drift must. */
const stableIdentityLinkPlan = plan => {
  const { checkedAt, ...rest } = plan;
  return rest;
};
export function assertReviewedIdentityLinkPlan(plan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved account-service link receipt');
  if (canonical(stableIdentityLinkPlan(plan)) !== canonical(stableIdentityLinkPlan(currentPlan)))
    throw new Error('Live registry, router authority or account-service pin changed; re-plan before linking');
  if (plan.openingAuthorized !== false || plan.admissionAuthorized !== false ||
      plan.groupRegistrationAuthorized !== false || plan.routingApprovalAuthorized !== false ||
      plan.rehearsalReleaseAuthorized !== false)
    throw new Error('Closed-only account-service link required');
}

/** The six rows that prove the identity canister trusts exactly one registry. */
export function bindingMatchesRows(binding, rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const map = rowsToMap(rows);
  return map.registry === binding.registry && map.target_alias === binding.targetAlias &&
    map.deployment_id === binding.deploymentId && map.host === binding.host &&
    map.network_kind === binding.networkKind;
}

/**
 * Full lifecycle readback. Also asserts the two switches this gate must leave
 * alone: rehearsal and admission stay off, and the bound-deletion protocol
 * reads as released rather than merely being written.
 */
export function assertIdentityLinkReadback({ routerConfig, identityConfig, identityEnv, page }, plan) {
  if (rowsToMap(routerConfig).deletion_authority !== plan.identityAccess)
    throw new Error('Router deletion authority readback failed');
  if (!bindingMatchesRows(plan.binding, identityConfig))
    throw new Error('Account-service registry pin readback failed');
  if (envValue(identityEnv, BOUND_DELETION_RELEASE_ENV) !== '1')
    throw new Error('Account-service environment readback failed');
  if (rowsToMap(identityConfig).bound_deletion_released !== 'true')
    throw new Error('Bound-deletion protocol did not read back as released');
  if (rowsToMap(identityConfig).account_admission_released !== 'false')
    throw new Error('Account admission must remain disabled after linking');
  if (envValue(identityEnv, REHEARSAL_ENV) === '1')
    throw new Error('Rehearsal must remain disabled after linking');
  if (page?.revision?.toString() !== plan.registryRevision ||
      JSON.stringify((page?.groups ?? []).map(g => g.id).sort()) !== JSON.stringify(plan.groups))
    throw new Error('Registry inventory changed during the account-service link');
  return {
    linked: true,
    openingAuthorized: false,
    admissionAuthorized: false,
    routingApprovalAuthorized: false,
  };
}

/**
 * Checkpointed apply. Each stage is journalled as an intent before its write and
 * verified by a live readback before the next intent, so a run that dies
 * mid-flight leaves a receipt that names the last stage it proved. A pending
 * intent is never replayed.
 */
export async function linkAccountService({ plan, receipt, checkpoint, setEnvironment, readEnvironment,
  setDeletionAuthority, readRouterConfig, pinRegistry, readIdentityConfig, readRegistryPage }) {
  if (receipt.pending) throw new Error('Unresolved account-service intent; reconcile without replay');
  if (receipt.phase !== 'planned' || receipt.planHash !== hashPlan(plan))
    throw new Error('Reviewed account-service link receipt required');

  let current = { ...receipt, pending: 'deletion-release' };
  await checkpoint(current);
  if (!bindingHasRelease(await readEnvironment(plan.identityAccess))) await setEnvironment(plan);
  if (!bindingHasRelease(await readEnvironment(plan.identityAccess)))
    throw new Error('Account-service environment readback failed');

  current = { ...current, pending: 'router-authority' };
  await checkpoint(current);
  if (!rowsToMap(await readRouterConfig()).deletion_authority) await setDeletionAuthority(plan);
  if (rowsToMap(await readRouterConfig()).deletion_authority !== plan.identityAccess)
    throw new Error('Router deletion authority readback failed');

  current = { ...current, pending: 'registry-pin' };
  await checkpoint(current);
  if (!bindingMatchesRows(plan.binding, await readIdentityConfig())) await pinRegistry(plan);
  if (!bindingMatchesRows(plan.binding, await readIdentityConfig()))
    throw new Error('Account-service registry pin readback failed');

  current = { ...current, pending: 'readback' };
  await checkpoint(current);
  const state = await readState({ readRouterConfig, readIdentityConfig, readEnvironment, readRegistryPage }, plan);
  const verified = assertIdentityLinkReadback(state, plan);
  await checkpoint({ ...current, pending: null, phase: 'linked', verified });
  return verified;
}

const bindingHasRelease = env => envValue(env, BOUND_DELETION_RELEASE_ENV) === '1';
export const readState = async ({ readRouterConfig, readIdentityConfig, readEnvironment, readRegistryPage }, plan) => ({
  routerConfig: await readRouterConfig(),
  identityConfig: await readIdentityConfig(),
  identityEnv: await readEnvironment(plan.identityAccess),
  page: await readRegistryPage(),
});

/**
 * Completes only a journalled run whose final readback was interrupted. It never
 * repeats an environment write, an authority bind or a registry pin.
 */
export async function reconcileIdentityLinkReadback({ receipt, expectedHash, readState: read, checkpoint }) {
  const hash = normalizeReviewedHash(expectedHash);
  if (!receipt || !/^[a-f0-9]{64}$/.test(hash) || receipt.planHash !== hash ||
      hashPlan(receipt.plan) !== hash || !['linked', 'planned'].includes(receipt.phase))
    throw new Error('Reviewed account-service link receipt required for reconciliation');
  if (!receipt.pending) {
    if (receipt.phase === 'linked') return { completed: true, verified: receipt.verified };
    throw new Error('Account-service link is not awaiting reconciliation');
  }
  if (receipt.pending !== 'readback')
    throw new Error('Account-service link intent must be reconciled by a fresh reviewed run, not a readback-only pass');
  const verified = assertIdentityLinkReadback(await read(receipt.plan), receipt.plan);
  await checkpoint({ ...receipt, pending: null, phase: 'linked', verified });
  return { completed: true, verified };
}

export const identityLinkSummary = (plan, verified) => [
  `PROD account service linked and independently read back: ${plan.identityAccess}.`,
  `Router deletion authority bound; registry pinned to ${plan.binding.registry} at revision ${plan.binding.registryRevision}.`,
  'Both groups remain CLOSED; routing approval remains a separate gate.',
  'Opening, admission, rehearsal, group registration, funding, deployments, DEV and database changes: none.',
  ...(verified ? [`Readback: ${JSON.stringify(verified)}.`] : []),
];
