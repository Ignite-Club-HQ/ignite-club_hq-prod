/**
 * Parent-facing ICP invitation child creation. The club-domain admin method
 * create_child_for_parent_on_team is NOT callable by a newly invited parent.
 * Parent self-service must create_own_child then set_own_child_team.
 *
 * No automatic retry of create_own_child: it has no request-id deduplication.
 * If team assignment fails after creation, report the partial state so the
 * UI never creates another child to "retry" a successful write.
 */
export type IcpInviteChildResult =
  | { status: "linked"; childId: string }
  | { status: "linked_without_name"; childId: string }
  | { status: "created_unlinked"; childId: string; nameSaved: boolean };

export async function createIcpInviteChild(
  input: { teamId: string; clubId: string; name: string },
  actions: {
    readTeam: () => Promise<{ id: string; club_id: string } | null>;
    createOwnChild: () => Promise<{ id: string }>;
    saveName: (childId: string) => Promise<void>;
    assignOwnChildToTeam: (childId: string) => Promise<unknown>;
  },
): Promise<IcpInviteChildResult> {
  if (!input.name.trim() || !input.teamId || !input.clubId) {
    throw new Error("Child name, club and team are required");
  }
  const team = await actions.readTeam();
  if (!team || team.id !== input.teamId || team.club_id !== input.clubId) {
    throw new Error("Invitation team/club mismatch; no child was created");
  }
  const child = await actions.createOwnChild();
  if (!child?.id) {
    throw new Error("Child creation could not be confirmed. Check your children list before retrying.");
  }
  // After create_own_child returns, every subsequent failure is a PARTIAL
  // SUCCESS. Try both independent follow-up actions exactly once; never lose
  // the created child ID or retry the non-idempotent create call.
  // These writes use different canisters and have no dependency on each
  // other once the child exists. Launch both once, reducing the two-update
  // waterfall without retrying either unknown write. Promise.resolve also
  // protects against a synchronous failure preventing the second attempt.
  const [nameResult, teamResult] = await Promise.allSettled([
    Promise.resolve().then(() => actions.saveName(child.id)),
    Promise.resolve().then(() => actions.assignOwnChildToTeam(child.id)),
  ]);
  // Never print a PII failure or the child's plaintext name in logs.
  const nameSaved = nameResult.status === "fulfilled";
  const teamLinked = teamResult.status === "fulfilled";
  if (!teamLinked) return { status: "created_unlinked", childId: child.id, nameSaved };
  if (!nameSaved) return { status: "linked_without_name", childId: child.id };
  return { status: "linked", childId: child.id };
}
