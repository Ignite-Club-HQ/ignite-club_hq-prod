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
  | { status: "created_unlinked"; childId: string };

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
  // This field is encrypted by the existing vault helper. It is best-effort,
  // consistent with the existing ICP Children page; no name enters club_domain.
  await actions.saveName(child.id);
  try {
    await actions.assignOwnChildToTeam(child.id);
  } catch {
    return { status: "created_unlinked", childId: child.id };
  }
  return { status: "linked", childId: child.id };
}
