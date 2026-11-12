/** Offline drafts only: no network operations or active routing changes. */
import { normalizeApprovedTarget, type ApprovedBackendTarget } from './backendRouting';
import { ENGINE_REQUIRED_CANISTERS } from './enginePreparation';

/** Ordered preparation steps only. Completion notes cannot arm admission. */
export const ENGINE_HANDOVER_STAGES = [
  { id: 'economics', requiresEngine: false, requires: [], action: 'Compare measured mainnet costs with a written rental and backup quote.' },
  { id: 'destination', requiresEngine: true, requires: ['economics'], action: 'Confirm console access, trusted address, subnet, capacity and deployment operator.' },
  { id: 'closed-install', requiresEngine: true, requires: ['destination'], action: 'Install the complete fresh inventory closed; verify modules, controllers and shared links.' },
  { id: 'calls', requiresEngine: true, requires: ['closed-install'], action: 'Verify bounded cycle-free calls in both directions and exact unknown-write outcome readback.' },
  { id: 'encryption', requiresEngine: true, requires: ['closed-install'], action: 'Implement official proxy encryption and prove authorized new-file decryption and revoked-user refusal.' },
  { id: 'isolated-club', requiresEngine: true, requires: ['calls', 'encryption'], action: 'Verify one isolated test club, mixed memberships, browser/phone sign-in, chat and group notifications.' },
  { id: 'operations', requiresEngine: true, requires: ['isolated-club'], action: 'Verify real rental readings, alert delivery and complete permission-preserving backup/restore.' },
  { id: 'owner-review', requiresEngine: true, requires: ['operations'], action: 'Obtain Paul’s opening approval for the exact reviewed deployment and revision.' },
  { id: 'new-clubs', requiresEngine: true, requires: ['owner-review'], action: 'Release verified authority-side admission for new clubs only; retain every existing assignment.' },
] as const;

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
    checklist: ENGINE_HANDOVER_STAGES.map(stage => ({ ...stage, requires: [...stage.requires], status: 'pending' as const })),
    checklistAuthorizesActivation: false,
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