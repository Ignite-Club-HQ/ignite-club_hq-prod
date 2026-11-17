/**
 * Non-mutating, caller-authorized duplicate preflight shared by both My
 * Children and ICP Parent invitation onboarding. Names NEVER leave their
 * source pii_access_control group in plaintext except inside this browser's
 * signed-in session. A failed/unreadable leg is NOT treated as an empty group.
 *
 * There is no server-side cross-group name dedupe, so concurrent sign-ins
 * remain a residual risk. Never automatically retry create_own_child.
 */
import { assertMayCreateChild, collectVerifiedChildren, requireSourceClubCanisterId } from "./icpChildrenGroupSafety";
import type { ChildNameForCheck } from "./icpChildrenGroupSafety";

/**
 * Invitation mode: the invite's own group is checked strictly by the caller
 * (where the child would be created or resumed). Other groups are best effort:
 * only a confirmed readable same-name child there blocks; an unreadable name
 * or an unanswered group is not treated as a duplicate.
 */
export async function verifyIcpChildNameInOtherGroups(name: string, inviteSourceClubCanisterId: string): Promise<void> {
  const [{ withFeatureBackend }, club, vault] = await Promise.all([
    import("@/live/featureRouter"),
    import("@/live/features/club"),
    import("@/live/features/vault"),
  ]);
  const wanted = name.trim().toLocaleLowerCase();
  const found = await withFeatureBackend<boolean>("membership", {
    supabase: async () => false,
    icp: async scoped => {
      if (requireSourceClubCanisterId(scoped.target) === inviteSourceClubCanisterId) return false;
      const children = await club.listMyLiveOwnChildren(scoped);
      if (children.length === 0) return false;
      const names = await vault.resolveLivePiiTextBatch(
        scoped, children.map(c => c.id), "name", "read", "child_duplicate_check",
      ).catch(() => new Map<string, string>());
      return children.some(c => names.get(c.id)?.trim().toLocaleLowerCase() === wanted);
    },
  }, { everyGroup: true, merge: parts => (parts as boolean[]).some(Boolean) }).catch(() => false);
  if (found) {
    throw new Error(`${name.trim()} already appears in your children in another club group. An existing child cannot be copied between groups automatically.`);
  }
}

export async function verifyIcpChildNameAcrossGroups(name: string): Promise<void> {
  const [{ withFeatureBackend }, club, vault] = await Promise.all([
    import("@/live/featureRouter"),
    import("@/live/features/club"),
    import("@/live/features/vault"),
  ]);
  const existing = await withFeatureBackend<ChildNameForCheck[]>("membership", {
    supabase: async () => { throw new Error("Internet Identity child inventory is required"); },
    icp: async scoped => {
      const sourceClubCanisterId = requireSourceClubCanisterId(scoped.target);
      const principal = scoped.identity.getPrincipal().toText();
      const children = await club.listMyLiveOwnChildren(scoped);
      if (children.length === 0) return [];
      const names = await vault.resolveLivePiiTextBatch(
        scoped, children.map(c => c.id), "name", "read", "child_duplicate_check",
      );
      return children.map(c => ({
        id: c.id, sourceClubCanisterId,
        name: names.get(c.id) ?? "",
        isPrimary: c.parent?.[0]?.toText() === principal,
      }));
    },
  }, {
    everyGroup: true, requireComplete: true,
    merge: parts => collectVerifiedChildren(parts as ChildNameForCheck[][]),
  });
  assertMayCreateChild(name, existing, true);
}
