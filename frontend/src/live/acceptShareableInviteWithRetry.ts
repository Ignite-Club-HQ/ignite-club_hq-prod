/**
 * A shareable team-invite redemption is idempotent in club_domain. The live
 * canister rejects "Account authority changed; retry" BEFORE granting a role
 * when the admission snapshot becomes stale across its consensus call.
 *
 * Permit exactly one fresh attempt for that specific, documented rejection.
 * Never retry other rejects or a changed signed-in principal, and never
 * replace the canister's authorisation, exclusion or membership checks.
 */
/** A shareable invitation may only be redeemed for the principal in the UI's verified session. */
export function assertShareableInvitePrincipal(authenticatedPrincipal: string, sessionPrincipal: string): void {
  if (!authenticatedPrincipal || !sessionPrincipal || authenticatedPrincipal !== sessionPrincipal) {
    throw new Error("Your Internet Identity changed during joining. Sign out, sign in with the intended identity, and review this invitation.");
  }
}

export function isTransientAccountAuthorityError(error: unknown): boolean {
  return /Account authority changed; retry/.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function acceptShareableInviteWithRetry<T>(
  submit: () => Promise<T>,
  signedInPrincipal: () => string,
): Promise<T> {
  const originalPrincipal = signedInPrincipal();
  try {
    return await submit();
  } catch (error) {
    if (!isTransientAccountAuthorityError(error)) throw error;
    // Do not replay the user's action if their account changed in the app.
    if (!originalPrincipal || signedInPrincipal() !== originalPrincipal) {
      throw new Error("Your sign-in changed during joining. Sign in again and review this invitation.");
    }
    // Exactly one retry: the server rechecks the account authority and the
    // invitation on every call; a second failure is propagated to the UI.
    return submit();
  }
}

export function shareableInviteJoinErrorMessage(error: Error): string {
  if (isTransientAccountAuthorityError(error)) {
    return "Your account permissions changed while Ignite checked this invitation. Joining could not be confirmed. Check whether you are already a member, then try again.";
  }
  return error.message || "Couldn't complete your join. Check your membership before retrying.";
}
