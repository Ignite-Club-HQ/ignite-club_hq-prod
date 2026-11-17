import { withFeatureBackend } from "@/live/featureRouter";

/**
 * Membership acceptance is exclusively on ICP. Email delivery is deferred
 * and must never make acceptance depend on an external application service.
 */
/** Longest the accept screen waits for child access setup before moving on. */
export const CHILD_ACCESS_WAIT_MS = 8_000;

export async function acceptIcpInviteAndWelcome(inviteId: string) {
  return withFeatureBackend("membership", {
    supabase: async () => { throw new Error("Internet Identity required"); },
    icp: async (ctx) => {
      const { acceptPendingLiveInvite, readLiveFamilyInviteReceipt } = await import("@/live/features/club");
      await acceptPendingLiveInvite(ctx, inviteId);
      const receipt = await readLiveFamilyInviteReceipt(ctx, inviteId);
      const { addLiveGuardianRelationship, grantLivePiiRead } = await import("@/live/features/vault");
      // Child access setup is best-effort and each call is a separate
      // canister round trip, so run every child (and its three fields) in
      // parallel, and stop holding the screen after a short wait — the
      // remaining grants finish in the background.
      const me = ctx.identity.getPrincipal();
      const setup = Promise.all(receipt.child_ids.map(async (id) => {
        try {
          await addLiveGuardianRelationship(ctx, me, id);
          const results = await Promise.allSettled(
            ["name", "year_of_birth", "jersey_number"].map((field) => grantLivePiiRead(ctx, id, field, me)),
          );
          if (results[0].status === "rejected") throw results[0].reason;
        } catch (error) {
          console.warn("Accepted invitation; encrypted child-name access needs retry", error);
        }
      }));
      await Promise.race([setup, new Promise((resolve) => setTimeout(resolve, CHILD_ACCESS_WAIT_MS))]);
      return receipt;
    },
  }, { inviteToken: inviteId });
}
