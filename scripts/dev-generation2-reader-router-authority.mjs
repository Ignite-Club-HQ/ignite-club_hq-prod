// A release is bound to consensus routing authority, not to diagnostic
// telemetry which can legitimately change while the authority stays fixed.
// The caller supplies the existing strictly validated approval configuration
// from groupApprovalConfiguration(groups, placements).
import { fingerprint } from './membership-source-configuration.mjs';

export function readerRouterAuthorityFingerprint(snapshot, approvalConfiguration) {
  if (!snapshot || snapshot.revision !== 11n ||
      typeof snapshot.configurationRevision !== 'bigint' ||
      snapshot.configurationRevision < 1n ||
      !Array.isArray(snapshot.groups) || snapshot.groups.length !== 1 ||
      !Array.isArray(snapshot.placements) || snapshot.placements.length !== 1 ||
      typeof approvalConfiguration !== 'string' || !approvalConfiguration.length) {
    throw new Error('Exact DEV generation-2 router authority evidence required');
  }
  return fingerprint({
    registryRevision: snapshot.revision,
    configurationRevision: snapshot.configurationRevision,
    approvedGroupAndPlacementConfiguration: approvalConfiguration,
  });
}
