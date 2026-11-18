/** Offline preparation only. No agents, credentials, management calls or writes.
 * Supplied observations are not independently verified release evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';
import { SHARED_SERVICES } from './all-group-upgrade-policy.mjs';
import { ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY } from './engine-browser/engine-controller-policy.mjs';
import { assertEngineFrontendContext } from './dev-engine-frontend-policy.mjs';

export const ENGINE_SUBNET = 'nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae';
export const ENGINE_PROXY = 'ynolw-eyaaa-aaaaj-qspkq-cai';
const SHA = /^[a-f0-9]{64}$/;
const noGovernor = new Set(['frontend', 'media_blob_store', 'timer_jobs']);
const deniedAuthority = () => ({ preparationOnly: true, independentlyVerified: false,
  activationAuthorized: false, deploymentAuthorized: false, promotionAuthorized: false });

/** Historical IDs/hashes are references, not fresh controller or code acceptance. */
export function createGroupedEngineDraft(observation, group2Inventory) {
  const group2 = group2Inventory?.canisterIds;
  if (group2Inventory !== undefined) {
    if (group2Inventory.schema !== 1 || group2Inventory.source !== 'owner-console-screenshot' ||
        group2Inventory.independentlyVerified !== false || !group2 ||
        Object.keys(group2).length !== 13 || GROUP_BUILD_SERVICES.some(s => !Object.hasOwn(group2, s)) ||
        Object.values(group2).some(id => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+-cai$/.test(id)) ||
        new Set(Object.values(group2)).size !== 13 ||
        Object.values(group2).some(id => Object.values(observation).some(row => row.id === id)))
      throw Error('Exact thirteen unique Group 2 owner-reported IDs required, separate from existing parts');
  }
  const row = (scope, service) => ({ scope, service,
    canisterId: scope === 'g2' ? group2?.[service] ?? null : observation[service]?.id ?? null,
    inventorySource: scope === 'g2' ? group2Inventory?.source ?? 'unassigned' : 'historical-installation-observation',
    reviewedModuleHash: null,
    historicalModuleHash: scope === 'g2' ? null : observation[service]?.hash ?? null });
  return { schema: 1, ...deniedAuthority(), branch: 'main', networkKind: 'cloud_engine',
    deploymentId: 'ignite-dev-opencloud', host: 'https://icp-api.io',
    engineId: 'engine-789969b4-e8ba-41b0-90a2-47b4dab699df',
    appPolicy: 'one-combined-app', subnetId: ENGINE_SUBNET, proxyId: ENGINE_PROXY,
    registryRevision: null,
    services: [row('shared', 'frontend'), ...SHARED_SERVICES.map(s => row('shared', s)),
      ...['g1', 'g2'].flatMap(g => GROUP_BUILD_SERVICES.map(s => row(g, s)))] };
}

function validateScope(plan) {
  if (plan?.schema !== 1 || plan.branch !== 'main' || plan.networkKind !== 'cloud_engine' ||
      plan.deploymentId !== 'ignite-dev-opencloud' || plan.appPolicy !== 'one-combined-app' ||
      plan.engineId !== 'engine-789969b4-e8ba-41b0-90a2-47b4dab699df' ||
      plan.host !== 'https://icp-api.io' || plan.subnetId !== ENGINE_SUBNET || plan.proxyId !== ENGINE_PROXY)
    throw Error('Exact DEV engine context required; no PROD or alternate destination');
  for (const [key, value] of Object.entries(deniedAuthority()))
    if (plan[key] !== value) throw Error('Preparation cannot grant execution authority');
  const expected = ['shared/frontend', ...SHARED_SERVICES.map(s => `shared/${s}`),
    ...['g1', 'g2'].flatMap(g => GROUP_BUILD_SERVICES.map(s => `${g}/${s}`))];
  const actual = plan.services?.map(s => `${s.scope}/${s.service}`);
  if (!actual || actual.length !== 32 || new Set(actual).size !== 32 || expected.some(s => !actual.includes(s)))
    throw Error('Exactly five shared services, one frontend and two thirteen-service groups required');
}

export function groupedPlanHash(plan) {
  validateScope(plan);
  const canonical = { branch: plan.branch, deploymentId: plan.deploymentId, host: plan.host,
    engineId: plan.engineId, subnetId: plan.subnetId, proxyId: plan.proxyId,
    registryRevision: plan.registryRevision,
    services: plan.services.map(({ scope, service, canisterId, reviewedModuleHash }) =>
      ({ scope, service, canisterId, reviewedModuleHash })).sort((a, b) =>
        `${a.scope}/${a.service}`.localeCompare(`${b.scope}/${b.service}`)) };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Review data only: no executable workflow, env file, transport or deployment hook. */
export function createGroupedUpdateCandidate(plan) {
  validateScope(plan);
  const ids = plan.services.map(s => s.canisterId);
  if (ids.some(id => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+-cai$/.test(id)) ||
      new Set(ids).size !== 32) throw Error('Complete unique inventory required for update preparation');
  const frontend = plan.services.find(s => s.scope === 'shared' && s.service === 'frontend')?.canisterId;
  const baseIds = Object.fromEntries(plan.services.filter(s => s.scope !== 'g2' && s.service !== 'frontend')
    .map(s => [s.service, s.canisterId]));
  const database = 'https://ecsdwrarzfexssxtrymj.supabase.co';
  assertEngineFrontendContext({ branch: plan.branch, frontend, database, ids: baseIds });
  return { schema: 1, ...deniedAuthority(), enabled: false, liveReadPerformed: false,
    planHash: groupedPlanHash(plan), branch: plan.branch, networkKind: plan.networkKind,
    host: plan.host, engineId: plan.engineId, subnetId: plan.subnetId, proxyId: plan.proxyId,
    database, frontend, frontendBaseServiceIds: baseIds,
    updateMode: 'upgrade-only-preserve-state', canisterCyclesPolicy: 'zero-cycles-no-mainnet-topups',
    consoleGroupingPolicy: 'merge-metadata-preserve-other-settings',
    targets: plan.services.map(s => ({ scope: s.scope, service: s.service, canisterId: s.canisterId,
      reviewedModuleHash: s.reviewedModuleHash,
      requiredControllers: s.service === 'frontend' ? [ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY] : [ENGINE_OWNER, DEV_GOVERNOR],
      internalGovernorRequired: noGovernor.has(s.service) ? null : DEV_GOVERNOR,
      proposedConsoleMetadata: { __META_PROJECT: 'ignite_dev',
        __META_MAIN_CANISTER: s.service === 'frontend' ? 'true' : 'false' } })),
    holds: ['owner-authorized-controller-and-internal-governor-readback',
      'independent-inventory-subnet-proxy-and-artifact-verification',
      'reciprocal-service-links-and-closed-two-group-registry',
      'fresh-name-photo-document-and-denied-access-acceptance',
      'separate-reviewed-dev-website-and-update-cutover'],
  };
}

/** Expand the existing closed bundle recipe into exact per-group review rows.
 * Method presence is a source check, not proof of installed ABI or authorization. */
export function createGroupedConnectionCandidate(plan) {
  const update = createGroupedUpdateCandidate(plan);
  const recipe = readFileSync(new URL('./engine-browser/links.txt', import.meta.url), 'utf8');
  const lookup = (scope, service) => {
    const row = plan.services.find(s => s.scope === scope && s.service === service);
    if (!row?.canisterId) throw Error('Connection target absent from complete inventory');
    return { scope, service, canisterId: row.canisterId };
  };
  const links = [];
  const interfaces = new Map();
  for (const scope of ['g1', 'g2']) {
    for (const line of recipe.trim().split('\n')) {
      const [service, method, shape, destinations, extra] = line.split('|');
      const names = destinations ? destinations.split(',') : [];
      if (extra !== undefined || !['none', 'one', 'two', 'vec'].includes(shape) ||
          names.length !== ({ none: 0, one: 1, two: 2, vec: 1 })[shape])
        throw Error('Unsupported closed connection recipe');
      const source = lookup(scope, service);
      const targets = names.map(name => lookup(SHARED_SERVICES.includes(name) ? 'shared' : scope, name));
      if (!interfaces.has(service)) {
        const bytes = readFileSync(new URL(`../backend/${service}/${service}.did`, import.meta.url));
        interfaces.set(service, { text: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      const abi = interfaces.get(service);
      if (!abi || !new RegExp(`\\b${method}\\s*:`).test(abi.text)) throw Error('Closed recipe method absent from source interface');
      links.push({ source, method, argumentShape: shape, targets, sourceInterfaceSha256: abi.sha256,
        readbackMethod: 'read_group_opening_configuration',
        currentValue: null, action: 'review-only', liveVerified: false,
        prerequisite: method === 'initialize' ? 'read-current-initialization-state-no-blind-replay' :
          'authorized-current-readback-add-missing-only-hold-differing-values' });
    }
  }
  const review = { schema: 1, ...deniedAuthority(), enabled: false, liveReadPerformed: false,
    planHash: update.planHash, branch: update.branch, host: update.host, engineId: update.engineId,
    recipeSha256: createHash('sha256').update(recipe).digest('hex'), links,
    groupReviews: ['g1', 'g2'].map(scope => ({ scope,
      services: plan.services.filter(s => s.scope === scope).map(s => ({ service: s.service,
        canisterId: s.canisterId, readbackMethod: 'read_group_opening_configuration',
        permissionRequirement: ['media_metadata', 'insights_domain'].includes(s.service) ?
          { permission_source: 'local_club_roles' } : s.service === 'timer_jobs' ? null :
          { club_domain: lookup(scope, 'club_domain').canisterId } })),
      photoStore: lookup(scope, 'media_blob_store'), piiAuthority: lookup(scope, 'pii_access_control'),
      proxyId: plan.proxyId, originalKeyCommitment: null, keyContinuityVerified: false })),
    sharedReviews: plan.services.filter(s => s.scope === 'shared').map(s => ({ ...s,
      action: 'held-separate-review', currentConfiguration: null,
      requirement: s.service === 'frontend' ? 'separate-website-cutover-after-acceptance' :
        'complete-both-group-binding-and-current-authority-review-no-singleton-overwrite' })),
    unresolved: ['installed-interface-and-reader-authorization', 'shared-registry-identity-placement-and-workload-bindings',
      'original-proxy-pii-keys-and-engine-build-settings', 'closed-registry-revision-and-admission-remains-off',
      'fresh-signed-in-two-group-acceptance'],
    switchBack: { executable: false, beforeCutover: [
      'record-current-mainnet-dev-website-update-targets-source-and-routing-revision',
      'retain-existing-mainnet-dev-canisters-data-and-key-authorities',
      'review-dev-only-before-images-without-exporting-secrets',
      'verify-new-website-identity-origin-and-sign-in-continuity'],
      onFailure: ['stop-cutover-and-hold-unknown-writes-without-replay',
        'restore-only-reviewed-dev-website-and-update-routing-before-images',
        'leave-engine-data-in-place-no-cross-platform-copy-or-reinstall',
        'verify-mainnet-dev-sign-in-existing-clubs-and-fresh-media'],
      prodChangesAllowed: false, dataRollbackAllowed: false },
  };
  return { ...review, connectionReviewHash: createHash('sha256').update(JSON.stringify(review)).digest('hex') };
}

/** Assess local capture input; never imply canister status was read by this tool.
 * All future IDs must be assigned/independently certified before capture. */
export function assessGroupedEngineReadiness(plan, capture, { now, maxAgeMs }) {
  validateScope(plan);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0)
    throw Error('Explicit observation time and freshness window required');
  const blockers = [];
  const block = reason => blockers.push(reason);
  const ids = plan.services.map(s => s.canisterId);
  if (ids.some(id => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+-cai$/.test(id)) ||
      new Set(ids).size !== 32) block('complete-unique-32-canister-inventory-required');
  if (!/^[1-9][0-9]*$/.test(plan.registryRevision ?? '')) block('decimal-registry-revision-required');
  if (plan.services.some(s => !SHA.test(s.reviewedModuleHash ?? '')) ||
      GROUP_BUILD_SERVICES.some(service => plan.services.find(s => s.scope === 'g1' && s.service === service)?.reviewedModuleHash !==
        plan.services.find(s => s.scope === 'g2' && s.service === service)?.reviewedModuleHash))
    block('reviewed-matching-group-artifacts-required');
  const hash = groupedPlanHash(plan);
  if (capture?.schema !== 1 || capture.source !== 'owner-capture' || capture.planHash !== hash ||
      !Number.isSafeInteger(capture.observedAtMs) || capture.observedAtMs < 0 ||
      capture.observedAtMs > now || now - capture.observedAtMs > maxAgeMs ||
      typeof capture.receipt !== 'string' || !capture.receipt.trim() || capture.receipt.length > 512)
    block('fresh-exact-bound-owner-capture-required');
  const rows = capture?.services;
  if (!Array.isArray(rows) || rows.length !== 32 ||
      new Set(rows.map(r => `${r.scope}/${r.service}`)).size !== 32) block('complete-readback-required');
  for (const s of plan.services) {
    const label = `${s.scope}/${s.service}`;
    const r = Array.isArray(rows) ? rows.find(r => r.scope === s.scope && r.service === s.service) : undefined;
    if (!r || r.canisterId !== s.canisterId || r.subnetId !== plan.subnetId ||
        r.moduleHash !== s.reviewedModuleHash || r.status !== 'running') { block(`${label}:module-subnet-status-unverified`); continue; }
    const expected = s.service === 'frontend' ? [ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY] : [ENGINE_OWNER, DEV_GOVERNOR];
    if (!Array.isArray(r.controllers) || r.controllers.length !== expected.length ||
        new Set(r.controllers).size !== expected.length || expected.some(p => !r.controllers.includes(p)))
      block(`${label}:controller-permissions-unverified`);
    if (!noGovernor.has(s.service) && r.internalGovernor !== DEV_GOVERNOR)
      block(`${label}:internal-governor-unverified`);
    if (s.service !== 'frontend' && r.configurationMatchesPlan !== true)
      block(`${label}:service-wiring-unverified`);
  }
  if (capture?.closedRegistryMatchesPlan !== true) block('closed-two-group-registry-unverified');
  if (capture?.originalKeyContinuityVerified !== true) block('original-engine-photo-key-continuity-unverified');
  return { ...deniedAuthority(), planHash: hash, canisterCount: 32, groupCount: 2,
    suppliedReadinessChecksPassed: blockers.length === 0, blockers,
    realEngineAcceptanceRequired: true, liveReadPerformed: false };
}

export const GROUPED_ENGINE_SCENARIOS = Object.freeze([
  'two-clubs-exact-distinct-placement', 'cross-group-member-roles-and-chat',
  'g1-gallery-fresh-authorized-decryption', 'g2-gallery-fresh-authorized-decryption',
  'g1-chat-document-mime-and-bytes', 'g2-chat-document-mime-and-bytes',
  'g1-vault-staff-allow-member-deny', 'g2-vault-staff-allow-member-deny',
  'outsider-name-photo-document-denial', 'removed-member-fresh-key-denial',
  'removed-member-retains-other-club', 'shared-identity-admin-and-invite-routing',
  'two-group-notification-audiences-and-timers', 'unknown-write-outcome-no-replay',
  'code-only-upgrade-preserves-both-group-data-and-keys',
  'engine-proxy-bounded-cycle-free-and-direct-http',
  'engine-storage-rental-and-readable-backup', 'browser-and-native-sign-in-continuity',
]);

/** Checklist accounting only; fixture passes cannot count as live acceptance. */
export function assessGroupedAcceptance(plan, records, { now, maxAgeMs }) {
  const planHash = groupedPlanHash(plan);
  if (!Array.isArray(records) || records.length > GROUPED_ENGINE_SCENARIOS.length ||
      new Set(records.map(r => r.scenario)).size !== records.length ||
      records.some(r => !GROUPED_ENGINE_SCENARIOS.includes(r.scenario)) ||
      !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0)
    throw Error('Bounded unique scenarios and explicit freshness required');
  const pending = GROUPED_ENGINE_SCENARIOS.filter(scenario => {
    const r = records.find(r => r.scenario === scenario);
    return !r || r.source !== 'engine-capture' || r.planHash !== planHash || r.passed !== true ||
      !Number.isSafeInteger(r.observedAtMs) || r.observedAtMs < 0 || r.observedAtMs > now || now - r.observedAtMs > maxAgeMs ||
      typeof r.receipt !== 'string' || !r.receipt.trim() || r.receipt.length > 512;
  });
  return { ...deniedAuthority(), planHash, pending, suppliedScenarioRecordsComplete: pending.length === 0,
    signedInFlowVerifiedByThisTool: false, externalVerificationRequired: true };
}

function localJson(path) {
  if (statSync(path).size > 256 * 1024) throw Error('Local preparation input exceeds 256 KiB');
  return JSON.parse(readFileSync(path, 'utf8'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (['draft', 'updates', 'connections'].includes(command) && args.length === 0) {
    const plan = createGroupedEngineDraft(
      localJson(new URL('../docs/dev-engine-combined-installation-observation.json', import.meta.url)),
      localJson(new URL('../docs/dev-engine-group2-owner-inventory.json', import.meta.url)));
    console.log(JSON.stringify(command === 'connections' ? createGroupedConnectionCandidate(plan) :
      command === 'updates' ? createGroupedUpdateCandidate(plan) : plan, null, 2));
  }
  else if (command === 'check' && args.length === 4) {
    const report = assessGroupedEngineReadiness(localJson(args[0]), localJson(args[1]), { now: Number(args[2]), maxAgeMs: Number(args[3]) });
    console.log(JSON.stringify(report, null, 2));
    if (!report.suppliedReadinessChecksPassed) process.exitCode = 1;
  } else throw Error('Usage: draft | updates | connections | check <local-plan.json> <local-capture.json> <now-ms> <max-age-ms>');
}