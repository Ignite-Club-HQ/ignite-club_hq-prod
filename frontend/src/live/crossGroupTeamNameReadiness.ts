import { accountAuthoritiesFromRegistry, type AccountRegistryBinding, type AccountRegistrySnapshot } from './accountAuthorityRegistry';

/**
 * Read-only deployment topology check for the DEV cross-group adult roster.
 *
 * This never authenticates a person, opens another PII service, grants access,
 * enables a release flag or converts a private profile reference into a name.
 * A registered source authority is necessary, never sufficient, to disclose.
 * Team-scoped canister checks and independent owner approval are still needed.
 */
export type TeamNameRoutePins = {
  sourceGroupId: string;
  targetGroupId: string;
  originalClubDomain: string;
  originalPiiCanister: string;
  targetClubDomain: string;
  targetPiiCanister: string;
};

export function verifyCrossGroupTeamNameRoute(
  snapshot: AccountRegistrySnapshot, binding: AccountRegistryBinding, pins: TeamNameRoutePins,
) {
  if (pins.sourceGroupId === pins.targetGroupId || !pins.sourceGroupId || !pins.targetGroupId ||
    new Set([pins.originalClubDomain, pins.originalPiiCanister, pins.targetClubDomain, pins.targetPiiCanister]).size !== 4) {
    throw new Error('A distinct pinned original and target group are required');
  }

  // The operator must independently pin both original and target authorities.
  // A profile's pii-display-name reference never creates binding evidence.
  if (!binding.requiredClubAuthorities.includes(pins.originalClubDomain) ||
      !binding.requiredClubAuthorities.includes(pins.targetClubDomain)) {
    throw new Error('Both operator-approved club authorities are required');
  }

  const groups = accountAuthoritiesFromRegistry(snapshot, binding);
  const source = snapshot.groups.find(group => group.id === pins.sourceGroupId);
  const target = snapshot.groups.find(group => group.id === pins.targetGroupId);
  if (!source || !target || !groups.some(row => row.groupId === source.id) ||
      !groups.some(row => row.groupId === target.id)) {
    throw new Error('Both groups must appear in the complete verified registry');
  }

  const authority = (group: NonNullable<typeof source>, domain: string) =>
    group.domains.find(row => row.domain === domain)?.canister.toText();
  if (authority(source, 'club_domain') !== pins.originalClubDomain ||
      authority(source, 'pii_access_control') !== pins.originalPiiCanister ||
      authority(target, 'club_domain') !== pins.targetClubDomain ||
      authority(target, 'pii_access_control') !== pins.targetPiiCanister) {
    throw new Error('Original or target adult-name authority differs from the pinned deployment');
  }

  return {
    sourceGroupId: source.id,
    targetGroupId: target.id,
    registryRevision: snapshot.revision,
    // Merely knowing the original PII route never authorises a disclosure.
    nameReadAuthorised: false as const,
    requiresLiveTeamPermission: true as const,
    requiresOwnerRelease: true as const,
  };
}


/** Operator-provided, governor-read Identity directory evidence. This object
 * alone is not proof of origin: it must be fetched from the pinned Identity
 * canister by an independently authenticated, approved read-only workflow. */
export type LegacyIdentityDirectoryReadback = {
  binding: {
    registry: import('@icp-sdk/core/principal').Principal;
    registry_revision: bigint;
    target_alias: string;
    deployment_id: string;
    deployment_revision: bigint;
    host: string;
    network_kind: string;
  };
  generation: bigint;
  inventory_digest: readonly number[] | Uint8Array;
  sources: ReadonlyArray<readonly [string, import('@icp-sdk/core/principal').Principal]>;
  enabled: boolean;
  app_enabled: boolean;
};

/**
 * The original G1 is intentionally an Identity-pinned LEGACY source in the
 * membership directory, not a fabricated modern shard-router placement.
 *
 * This audits two independently sourced facts, and never drives a decrypt:
 *   1. The complete registered G2 (and any future registered groups).
 *   2. The governor-read Identity directory's exact G1 + registered sources.
 *
 * The original G1 PII authority is operator-pinned, NOT independently
 * attested by a Club source mapping. A passing topology check does NOT release
 * an encrypted name or certify PII-key continuity/service allowlisting.
 */
export function inspectLegacyGroup1TeamNameTopology(
  snapshot: AccountRegistrySnapshot,
  registeredBinding: AccountRegistryBinding,
  directory: LegacyIdentityDirectoryReadback,
  pins: TeamNameRoutePins & { routerCanister: string },
) {
  if (pins.sourceGroupId !== 'g1' || pins.targetGroupId !== 'g2' ||
      !pins.originalClubDomain || !pins.originalPiiCanister ||
      !pins.targetClubDomain || !pins.targetPiiCanister ||
      new Set([pins.originalClubDomain, pins.originalPiiCanister,
        pins.targetClubDomain, pins.targetPiiCanister]).size !== 4) {
    throw new Error('Exact disjoint legacy G1 and registered G2 pins required');
  }
  // The registry binding must not claim that legacy G1 has a modern placement:
  // it binds the registered inventory only. The independently approved legacy
  // authority is verified against Identity's pinned-source readback below.
  if (registeredBinding.requiredClubAuthorities.includes(pins.originalClubDomain) ||
      !registeredBinding.requiredClubAuthorities.includes(pins.targetClubDomain)) {
    throw new Error('Registered and legacy authority bindings must remain distinct');
  }
  const registered = accountAuthoritiesFromRegistry(snapshot, registeredBinding);
  if (registered.some(g => g.groupId === pins.sourceGroupId)) {
    throw new Error('Legacy G1 unexpectedly registered: require a different verified routing plan');
  }
  const target = snapshot.groups.find(g => g.id === pins.targetGroupId);
  if (!target || target.domains.find(x => x.domain === 'club_domain')?.canister.toText() !== pins.targetClubDomain ||
      target.domains.find(x => x.domain === 'pii_access_control')?.canister.toText() !== pins.targetPiiCanister ||
      snapshot.groups.some(g => g.domains.some(d => d.canister.toText() === pins.originalClubDomain ||
        d.canister.toText() === pins.originalPiiCanister))) {
    throw new Error('Original service collision or changed target G2 placement');
  }

  const wire = directory.binding;
  // Each failure is a stable, non-sensitive diagnostic. The previous combined
  // boolean masked whether an intentionally gated directory was disabled,
  // stale, or pointed at a different deployment. Never log directory payloads,
  // personal identifiers, keys or source inventories.
  const blocked = (reason: string): never => {
    throw new Error(`Current complete Identity directory binding/readback is required: ${reason}. No private-name access was attempted.`);
  };
  if (wire.registry.toText() !== pins.routerCanister) blocked('original router authority mismatch');
  if (wire.registry_revision !== snapshot.revision) blocked('Identity directory revision differs from the live router revision');
  if (wire.registry_revision !== registeredBinding.registryRevision) blocked('Identity directory revision differs from the approved registry pin');
  if (wire.target_alias !== (registeredBinding.registryAlias ?? registeredBinding.targetAlias)) blocked('deployment alias mismatch');
  if (wire.deployment_id !== registeredBinding.deploymentId) blocked('deployment identity mismatch');
  if (wire.deployment_revision !== registeredBinding.deploymentRevision) blocked('deployment revision mismatch');
  if (wire.host !== registeredBinding.host) blocked('deployment host mismatch');
  if (wire.network_kind !== registeredBinding.networkKind) blocked('network kind mismatch');
  if (!directory.enabled) blocked('Identity membership directory disabled');
  if (!directory.app_enabled) blocked('Identity membership directory reader not released');
  if (directory.generation < 1n) blocked('directory generation not activated');
  if (directory.inventory_digest.length !== 32) blocked('inventory fingerprint missing or invalid');

  const actual = directory.sources.map(([groupId, authority]) => [groupId, authority.toText()] as const);
  const expected = [
    [pins.sourceGroupId, pins.originalClubDomain] as const,
    ...snapshot.groups.map(g => [g.id,
      g.domains.find(d => d.domain === 'club_domain')?.canister.toText() ?? ''] as const),
  ];
  if (actual.length !== expected.length || new Set(actual.map(([g]) => g)).size !== actual.length ||
      expected.some(([g, cid]) => actual.filter(([observed, p]) => observed === g && p === cid).length !== 1)) {
    throw new Error('Identity source inventory omits or replaces legacy G1/registered services');
  }

  return {
    legacySource: pins.originalClubDomain,
    targetClub: pins.targetClubDomain,
    targetPii: pins.targetPiiCanister,
    registryRevision: snapshot.revision,
    directoryGeneration: directory.generation,
    verifiedSourceMapping: true as const,
    originalPiiKeyVerified: false as const,
    nameReadAuthorised: false as const,
    requiresOriginalPiiIdentityAllowlist: true as const,
    requiresLiveTeamPermission: true as const,
    requiresOwnerRelease: true as const,
  };
}

/** Read-only classification of independently observed registry revisions.
 * This reports a mismatch; it does not allow pin substitution or repair.
 * A future/older directory requires the operator's fenced recovery process.
 */
export function classifyLegacyIdentityDirectoryRevision(
  liveRouterRevision: bigint,
  savedIdentityRevision: bigint,
): 'matching' | 'identity-behind-router' | 'identity-ahead-of-router' {
  if (liveRouterRevision < 1n || savedIdentityRevision < 1n)
    throw new Error('Both observed registry revisions must be positive');
  return savedIdentityRevision === liveRouterRevision ? 'matching'
    : savedIdentityRevision < liveRouterRevision
      ? 'identity-behind-router' : 'identity-ahead-of-router';
}
