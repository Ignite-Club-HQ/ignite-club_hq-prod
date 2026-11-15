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

  const authority = (group: typeof source, domain: string) =>
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
