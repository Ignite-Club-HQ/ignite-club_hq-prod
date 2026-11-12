/** Offline drafts only: no network operations or active routing changes. */
import { normalizeApprovedTarget, type ApprovedBackendTarget } from './backendRouting';
import { ENGINE_REQUIRED_CANISTERS } from './enginePreparation';

export function createFutureEngineDraft(existing: readonly Pick<ApprovedBackendTarget, 'id'>[]): ApprovedBackendTarget {
  const ids = new Set(existing.map(target => target.id));
  let suffix = 1;
  while (ids.has(`icp/future-engine-${suffix}/v1`)) suffix += 1;
  return normalizeApprovedTarget({ backend: 'icp', kind: 'icp-cloud-engine', alias: `future-engine-${suffix}`, version: 'v1', enabled: false });
}

export function prepareEngineHandover(target: ApprovedBackendTarget) {
  if (target.backend !== 'icp' || target.kind !== 'icp-cloud-engine') throw new Error('Select a Cloud Engine draft.');
  return {
    format: 'ignite-cloud-engine-preparation', version: 1,
    preparationOnly: true, activationAuthorized: false,
    target: normalizeApprovedTarget({ ...target, enabled: false }),
    // Not an importable routing config; exclude all active country pins.
    requiredServices: [...ENGINE_REQUIRED_CANISTERS],
    existingClubPolicy: 'retain-original-deployment',
    encryptedMediaPolicy: 'do-not-move-existing-encrypted-clubs',
    remainingWork: [
      'Obtain engine console access, API trust, subnet, capacity and rental terms.',
      'Install fresh complete groups and shared services through an engine-specific deployment connection.',
      'Verify bounded, cycle-free cross-subnet calls in both directions and reconcile unknown writes.',
      'Implement and verify caller-isolated encryption through the official console proxy.',
      'Complete authority-side new-club placement and mixed-deployment membership routing.',
      'Verify browser/native identity, encrypted uploads, permissions, timers and group push coverage.',
      'Verify rental alerts and readable backup/restore before owner-approved opening.',
    ],
  };
}