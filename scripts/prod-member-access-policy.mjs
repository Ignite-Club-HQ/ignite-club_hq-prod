// Admission-only PROD member access: the smallest switch that lets signed-in
// members use their clubs. It deliberately never touches the global account
// removal or erasure settings that `protectionEnvironment` always pairs with
// admission, and it refuses to run where those are already released.
import { canonical, hashPlan, normalizeReviewedHash } from './prod-base-group-policy.mjs';
import { assertGroupsClosed } from './prod-safeguard-live-policy.mjs';
import { envValue, rowsToMap, bindingMatchesRows, BOUND_DELETION_RELEASE_ENV } from './prod-identity-link-policy.mjs';
import { digest, HUMAN_DOMAINS } from './prod-protection-policy.mjs';

export const MEMBER_ACCESS_RECEIPT_PATH = 'prod-group-setup/member-access.json';
export const MEMBER_ACCESS_CONFIRMATION = 'ENABLE PROD MEMBER ACCESS';
export const MEMBER_ACCESS_READBACK_CONFIRMATION = 'CONFIRM PROD MEMBER ACCESS READBACK';
export const MEMBER_ACCESS_ACTIONS = Object.freeze(['plan', 'inspect', 'apply', 'commission', 'readback']);

const AUTHORITY_FLAG = 'IGNITE_ACCOUNT_SERVICE_IDENTITY';
const ADMISSION_FLAG = 'IGNITE_ACCOUNT_ADMISSION_RELEASE';
const REMOVAL_FLAG = 'IGNITE_ACCOUNT_REMOVAL_RELEASE';
const REHEARSAL_FLAG = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';

/**
 * The account service's own commissioning guard demands exactly these 24
 * receivers: every human-facing domain plus each group's photo store. Anything
 * else in the live registry (router, timer jobs, secret workers, the account
 * service itself) must stay out of scope.
 */
export function memberAccessTargets(ids, page) {
  assertGroupsClosed(page);
  const targets = new Map();
  for (const group of page.groups) {
    const rows = [...(group.domains ?? []), ...(group.photo_store ?? []).map(canister =>
      ({ domain: 'media_blob_store', canister }))];
    const human = rows.filter(row => HUMAN_DOMAINS.includes(row.domain));
    const names = human.map(row => row.domain).sort();
    if (JSON.stringify(names) !== JSON.stringify([...HUMAN_DOMAINS].sort()))
      throw new Error(`${group.id} group must expose exactly the twelve reviewed human domains`);
    for (const row of human) {
      if (targets.has(row.canister)) throw new Error('Unexpected shared member reader');
      targets.set(row.canister, { name: row.domain, id: row.canister, group: group.id });
    }
  }
  const rows = [...targets.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (rows.length !== 24 || rows.some(t => t.id === ids.identity_access || t.id === ids.shard_router) ||
      new Set(rows.map(t => t.group)).size !== 2)
    throw new Error('Exactly twenty-four member readers across both groups required');
  return rows;
}

/**
 * Merges the two admission settings onto a service's existing environment while
 * preserving every unrelated setting. Unlike the protection activation helper it
 * never writes the removal flag, and it refuses to proceed where global removal
 * or local rehearsal is already on, because ordinary access must be provable
 * without them.
 */
export function memberAccessEnvironment(rows, identity) {
  if (!Array.isArray(rows)) throw new Error('Current environment settings required');
  const entries = new Map(rows.map(row => [row.name, row.value]));
  if (entries.get(REHEARSAL_FLAG) === '1') throw new Error('Rehearsal forbidden on production');
  if (entries.get(REMOVAL_FLAG) === '1')
    throw new Error('Global account removal is already released; ordinary access requires separate review');
  const previous = entries.get(AUTHORITY_FLAG);
  if (previous && previous !== identity) throw new Error('Foreign account authority requires separate review');
  entries.set(AUTHORITY_FLAG, identity);
  entries.set(ADMISSION_FLAG, '1');
  return [...entries].map(([name, value]) => ({ name, value }));
}

const decimal = (value, label) => {
  if (!/^\d+$/.test(String(value ?? ''))) throw new Error(`${label} must be decimal text`);
  return String(value);
};

/** The commissioning request must be the registry the account service already trusts. */
export function memberAccessBinding(linkReceipt, page) {
  if (!linkReceipt || linkReceipt.phase !== 'linked' || linkReceipt.pending)
    throw new Error('Acknowledged account-service link receipt required before member access');
  const saved = linkReceipt.plan?.binding ?? linkReceipt.binding;
  if (!saved) throw new Error('Account-service link receipt carries no registry binding');
  const binding = {
    registry: saved.registry,
    registry_revision: BigInt(decimal(saved.registryRevision, 'registry revision')),
    target_alias: saved.targetAlias,
    deployment_id: saved.deploymentId,
    deployment_revision: BigInt(decimal(saved.deploymentRevision, 'deployment revision')),
    host: saved.host,
    network_kind: saved.networkKind,
  };
  if (binding.registry !== page?.groups?.[0]?.target_alias && !page?.placements?.length)
    throw new Error('Live registry unavailable for member access binding');
  return binding;
}

/**
 * Builds the reviewable plan. It records only commitments (hashes), never
 * plaintext settings, and carries no authorization to open groups, approve
 * routing, release removal, or erase or recover any account.
 */
export function buildMemberAccessPlan({ ids, env, principal, page, identityConfig, linkReceipt, environments, checkedAt }) {
  const targets = memberAccessTargets(ids, page);
  const binding = memberAccessBinding(linkReceipt, page);
  if (!bindingMatchesRows({ registry: binding.registry, targetAlias: binding.target_alias,
    deploymentId: binding.deployment_id, host: binding.host, networkKind: binding.network_kind }, identityConfig))
    throw new Error('Account service is not pinned to the reviewed registry');
  if (rowsToMap(identityConfig).bound_deletion_released !== 'true')
    throw new Error('Bound deletion must read back as released before member access');
  if (envValue(identityConfig, REHEARSAL_FLAG) === '1') throw new Error('Rehearsal forbidden on production');

  const reviewed = targets.map(target => {
    const rows = environments?.[target.id];
    if (!Array.isArray(rows)) throw new Error(`Current settings unavailable for ${target.name}`);
    const after = memberAccessEnvironment(rows, ids.identity_access);
    const before = digest([...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
    const changed = digest([...after].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) !== before;
    return { name: target.name, id: target.id, group: target.group, beforeCommitment: before,
      afterCommitment: digest([...after].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
      changeRequired: changed };
  });

  return {
    version: 1,
    purpose: 'Enable ordinary PROD member access while both groups stay closed',
    sourceCommit: env.GITHUB_SHA,
    checkedAt,
    principal,
    identityAccess: ids.identity_access,
    routerId: ids.shard_router,
    registryRevision: decimal(page.revision, 'registry revision'),
    configurationRevision: decimal(page.configuration_revision?.[0] ?? 0, 'configuration revision'),
    groups: page.groups.map(group => group.id).sort(),
    binding,
    targets: reviewed,
    executable: false,
    openingAuthorized: false,
    routingApprovalAuthorized: false,
    removalReleaseAuthorized: false,
    globalErasureAuthorized: false,
    globalRecoveryAuthorized: false,
    rehearsalReleaseAuthorized: false,
    groupRegistrationAuthorized: false,
  };
}

const stableMemberAccessPlan = plan => {
  const { checkedAt, ...rest } = plan;
  return rest;
};

export function assertReviewedMemberAccessPlan(plan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved member-access receipt');
  if (canonical(stableMemberAccessPlan(plan)) !== canonical(stableMemberAccessPlan(currentPlan)))
    throw new Error('Live registry, account service or service settings changed; re-plan before applying');
  for (const flag of ['openingAuthorized', 'routingApprovalAuthorized', 'removalReleaseAuthorized',
    'globalErasureAuthorized', 'globalRecoveryAuthorized', 'rehearsalReleaseAuthorized',
    'groupRegistrationAuthorized'])
    if (plan[flag] !== false) throw new Error(`Closed-only member access required (${flag})`);
}

/**
 * The state ordinary access must leave behind: every reader bound to one account
 * service with admission on and removal off, the account service reporting
 * ordinary access commissioned with global operations still deferred, and both
 * groups still closed.
 */
export function assertMemberAccessReadback({ identityConfig, environments, page }, plan) {
  const rows = rowsToMap(identityConfig);
  if (rows.account_admission_released !== 'true') throw new Error('Account admission did not read back as released');
  if (rows.bound_deletion_released !== 'true') throw new Error('Bound deletion did not read back as released');
  if (rows.ordinary_member_access !== 'true') throw new Error('Ordinary member access did not read back');
  if (rows.global_account_operations_deferred !== 'true')
    throw new Error('Global account operations must remain deferred under ordinary access');
  assertGroupsClosed(page);
  if (String(page.revision) !== plan.registryRevision)
    throw new Error('Registry inventory changed during member access delivery');
  for (const target of plan.targets) {
    const rows = environments?.[target.id];
    if (!Array.isArray(rows)) throw new Error(`Settings readback unavailable for ${target.name}`);
    if (envValue(rows, AUTHORITY_FLAG) !== plan.identityAccess)
      throw new Error(`${target.name} is not bound to the reviewed account service`);
    if (envValue(rows, ADMISSION_FLAG) !== '1') throw new Error(`${target.name} admission is not enabled`);
    if (envValue(rows, REMOVAL_FLAG) === '1') throw new Error(`${target.name} must keep global removal off`);
    if (envValue(rows, REHEARSAL_FLAG) === '1') throw new Error(`${target.name} must keep rehearsal off`);
  }
  return {
    memberAccessEnabled: true,
    readers: plan.targets.length,
    openingAuthorized: false,
    routingApprovalAuthorized: false,
    removalReleaseAuthorized: false,
    globalErasureAuthorized: false,
    globalRecoveryAuthorized: false,
  };
}

export function memberAccessSummary(plan) {
  const lines = [
    '## Ordinary PROD member access',
    '',
    `- Account service: \`${plan.identityAccess}\``,
    `- Registry revision: ${plan.registryRevision} (configuration ${plan.configurationRevision})`,
    `- Reader services: ${plan.targets.length} (${plan.targets.filter(t => t.changeRequired).length} need a settings change)`,
    '- Global account removal, erasure and recovery: **stays off**',
    '- Group opening and routing approval: **not authorized here**',
    '',
    '| Service | Group | Settings change |',
    '| --- | --- | --- |',
    ...plan.targets.map(target => `| ${target.name} (${target.group}) | \`${target.id}\` | ${target.changeRequired ? 'required' : 'none'} |`),
  ];
  return lines.join('\n');
}
