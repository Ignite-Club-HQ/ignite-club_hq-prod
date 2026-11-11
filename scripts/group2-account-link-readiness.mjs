/**
 * Read-only interpretation of the shared identity service's governor-verified
 * configuration. Group reader eligibility and account-linking are different
 * capabilities. This function never authorizes or performs a canister call.
 */
export function group2AccountLinkReadiness(rows, linkedAccountReadback = null) {
  const evidence = new Map();
  for (const [key, value] of rows) {
    if (evidence.has(key) && evidence.get(key) !== value) {
      return { ready: false, status: 'invalid_evidence', action: 'Conflicting identity configuration rows; stop and verify the authority.', eligibility: false, memberAccess: false, linked: false };
    }
    evidence.set(key, value);
  }
  const eligibility = evidence.get('account_admission_released') === 'true';
  const memberAccess = evidence.get('ordinary_member_access') === 'true';
  // The ordinary member path is the only release mode exposed by this
  // configuration readback that guarantees account reads without a separate
  // signed production-reader approval (which this read does not attest).
  const linked = linkedAccountReadback?.status === 'verified' &&
    typeof linkedAccountReadback.accountId === 'string' &&
    linkedAccountReadback.accountId.length > 0 &&
    linkedAccountReadback.accountId === linkedAccountReadback.identityAccountId;
  const ready = memberAccess && linked;
  return {
    ready,
    status: ready ? 'linked' : linked ? 'read_verified_but_release_unknown'
      : memberAccess ? 'requires_signed_in_readback' : 'member_access_not_commissioned',
    eligibility,
    memberAccess,
    linked,
    action: ready ? null : memberAccess
      ? 'Use the signed-in Test account to call sync_my_linked_account, then verify read_account_whoami matches identity_access.whoami. Do not infer success from configuration.'
      : 'Eligibility reader authorization alone cannot fix read_linked_account. Obtain separately reviewed ordinary-member access commissioning (or independently signed account-reader capability) and verify live reads. Do not enable rehearsal flags or modify the live router.',
  };
}
