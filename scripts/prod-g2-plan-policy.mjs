// Pure review policy. This proposal cannot spend cycles or authorize creation.
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { canonical, hashPlan } from './prod-base-group-policy.mjs';

export const G2_SERVICES = Object.freeze([...GROUP_DOMAINS, 'media_blob_store']);
export const INITIAL_CYCLES = 1_500_000_000_000n;
export const ESTIMATED_CREATION_FEE = 100_000_000_000n;
const decimal = (value, label) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`Invalid ${label}`);
  return BigInt(value);
};
const immutableGroup = g => {
  const { heap_bytes, cycles, observed_at_ns, ...configuration } = g;
  return configuration;
};

export function buildProdG2Plan({ ids, env, principal, receipt, page, observations, balance, checkedAt }) {
  assertCheckContext(ids, env, principal);
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Exact source commit required');
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  if (receipt?.phase !== 'registered-closed' || receipt.pending !== null ||
      !receipt.plan || receipt.planHash !== hashPlan(receipt.plan) ||
      receipt.plan.principal !== principal || receipt.plan.openingAuthorized !== false ||
      receipt.plan.lifecycleReleaseAuthorized !== false) throw new Error('Confirmed closed base receipt required');
  if (page?.next_cursor?.length || page?.groups?.length !== 1 || page?.placements?.length !== 1)
    throw new Error('Complete base-only registry required; existing or unknown g2 needs separate review');
  const group = page.groups[0], placement = page.placements[0];
  if (group.id !== 'base' || group.accepting !== false || group.assigned_clubs !== 0 ||
      canonical(immutableGroup(group)) !== canonical(immutableGroup(receipt.plan.group)) ||
      canonical(placement) !== canonical(receipt.plan.placement)) throw new Error('Live closed base configuration differs from reviewed receipt');
  const revision = decimal(page.revision, 'registry revision');
  const configurationRevision = decimal(page.configuration_revision?.[0], 'configuration revision');
  if (revision < decimal(receipt.placementRevision, 'receipt revision') || configurationRevision < 2n)
    throw new Error('Registry revision predates confirmed base');
  if (placement.deployment_id !== 'prod' || placement.host !== 'https://icp-api.io' ||
      placement.network_kind !== 'public_mainnet' || placement.additional_subnets_enabled ||
      placement.approved_subnets?.length !== 1 || placement.primary_subnet !== placement.approved_subnets[0])
    throw new Error('Exact single-subnet PROD placement required');
  const names = Object.keys(PROD_CHECK_IDS).sort();
  if (!Array.isArray(observations) || observations.length !== names.length || new Set(observations.map(o => o.name)).size !== names.length)
    throw new Error('Complete certified PROD infrastructure evidence required');
  const certified = names.map(name => {
    const o = observations.find(o => o.name === name);
    if (!o || o.id !== ids[name] || !/^[a-f0-9]{64}$/.test(o.moduleHash ?? '') ||
        o.controllers?.length !== 1 || o.controllers[0] !== principal || o.subnet !== placement.primary_subnet)
      throw new Error('Certified PROD infrastructure mismatch');
    return { name, id: o.id, moduleHash: o.moduleHash, controllers: o.controllers, subnet: o.subnet };
  });
  const available = decimal(balance, 'account balance');
  const retained = BigInt(G2_SERVICES.length) * INITIAL_CYCLES;
  const fees = BigInt(G2_SERVICES.length) * ESTIMATED_CREATION_FEE;
  const estimated = retained + fees;
  return { version: 1, purpose: 'Independent PROD g2 review and funding estimate only', sourceCommit: env.GITHUB_SHA,
    checkedAt, principal, baseReceiptHash: hashPlan(receipt), basePlanHash: receipt.planHash,
    registryRevision: revision.toString(), configurationRevision: configurationRevision.toString(),
    deploymentId: 'prod', targetAlias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
    primarySubnet: placement.primary_subnet, additionalSubnetsEnabled: false,
    services: G2_SERVICES.map(name => ({ name, canisterId: null, initialCycles: INITIAL_CYCLES.toString() })),
    sharedInfrastructure: Object.fromEntries(['identity_access', 'shard_router', 'placement_registry', 'migration_coordinator', 'secret_workload_identity'].map(n => [n, ids[n]])),
    observations: certified,
    funding: { account: { owner: principal, subaccount: null }, balanceCycles: available.toString(),
      initialRetainedFuelCycles: retained.toString(), estimatedCreationFeesCycles: fees.toString(),
      estimatedRequiredCycles: estimated.toString(), shortfallCycles: (estimated > available ? estimated - available : 0n).toString(),
      exactQuote: false, excludes: ['Installation/configuration execution costs', 'Subsequent running/storage costs', 'Card gateway fees and exchange quote'],
      note: 'Retained fuel is not a consumed fee. Recheck live fee/balance and approve a bounded spend ceiling before creation.' },
    executable: false, creationAuthorized: false, fundingAuthorized: false, openingAuthorized: false, lifecycleReleaseAuthorized: false,
    remainingGates: ['Independent PROD-only journaled closed creation/configuration runner and reviewed build hashes',
      'Fresh fee-inclusive funding plan and explicit spending approval', 'Identity registry binding', 'Router identity binding',
      'Exact supported bound-deletion verification', 'Closed g2 registration and configuration-bound routing approval',
      'Separate explicit admission approval'],
  };
}

export function g2PlanSummary(plan) {
  const trillions = value => `${BigInt(value) / 1_000_000_000n / 1000n}.${(BigInt(value) % 1_000_000_000_000n / 1_000_000_000n).toString().padStart(3, '0')}T`;
  return ['### PROD second group — review only', '', `Proposal hash: \`${hashPlan(plan)}\``, '',
    '13 NEW independent services: 12 domains and one dedicated photo store. No DEV IDs or data reused.',
    `Initial retained fuel: ${trillions(plan.funding.initialRetainedFuelCycles)}. Estimated creation fees: ${trillions(plan.funding.estimatedCreationFeesCycles)}.`,
    `Estimated requirement: ${trillions(plan.funding.estimatedRequiredCycles)}. Current signing-account balance: ${trillions(plan.funding.balanceCycles)}.`,
    `Estimated shortfall: ${trillions(plan.funding.shortfallCycles)}. This is not a card price or an exact spend quote.`,
    'No payment, creation, configuration, registration, opening, database or DEV changes were made.',
    'Keep PROD closed. Review the evidence before approving any spending; do not run TEST group installation.', '',
    ...plan.remainingGates.map(g => `- ${g}`)].join('\n') + '\n';
}