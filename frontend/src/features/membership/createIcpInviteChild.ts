/**
 * Parent-facing ICP invitation child creation. The club-domain admin method
 * create_child_for_parent_on_team is NOT callable by a newly invited parent.
 * Parent self-service must create_own_child then set_own_child_team.
 *
 * No automatic retry of create_own_child: it has no request-id deduplication.
 * If team assignment fails after creation, report the partial state so the
 * UI never creates another child to "retry" a successful write. A later
 * attempt resumes that exact child (see planIcpInviteChild) instead.
 */
export type IcpInviteChildResult =
  | { status: "linked"; childId: string; recovered?: boolean }
  | { status: "linked_without_name"; childId: string }
  | { status: "created_unlinked"; childId: string; nameSaved: boolean };

/** One of the caller's own children in the invite's canister group. A null
 * name means it could not be read — never proof of a duplicate. */
export type OwnChildSnapshot = { id: string; teams: readonly string[]; name: string | null };

/** Exact record of an earlier partially completed invite child. */
export type InviteChildJournal = {
  childId: string; teamId: string; clubId: string; name: string; nameSaved: boolean;
};

export type InviteChildPlan =
  | { kind: "create" }
  | { kind: "recover"; childId: string; needsTeam: boolean; needsName: boolean };

const norm = (value: string) => value.trim().toLocaleLowerCase();

/**
 * Decide between creating a new child and resuming an existing record.
 * Only an exact journal entry or a *confirmed readable* same-name child can be
 * resumed; unreadable names never block creation and are never relabelled.
 */
export function planIcpInviteChild(
  input: { teamId: string; clubId: string; name: string },
  children: readonly OwnChildSnapshot[],
  journal: InviteChildJournal | null,
): InviteChildPlan {
  const wanted = norm(input.name);
  if (journal && journal.teamId === input.teamId && journal.clubId === input.clubId && norm(journal.name) === wanted) {
    const child = children.find(c => c.id === journal.childId);
    if (child) {
      const nameConfirmed = child.name !== null && norm(child.name) === wanted;
      return { kind: "recover", childId: child.id, needsTeam: !child.teams.includes(input.teamId), needsName: !journal.nameSaved && !nameConfirmed };
    }
  }
  const matches = children.filter(c => c.name !== null && norm(c.name) === wanted);
  if (matches.length > 1) {
    throw new Error(`More than one of your children is named ${input.name.trim()}. Ask your team admin to add the right one; nothing was changed.`);
  }
  if (matches.length === 1) {
    return { kind: "recover", childId: matches[0].id, needsTeam: !matches[0].teams.includes(input.teamId), needsName: false };
  }
  return { kind: "create" };
}

export async function createIcpInviteChild(
  input: { teamId: string; clubId: string; name: string; recover?: Extract<InviteChildPlan, { kind: "recover" }> },
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
  const recover = input.recover;
  let childId: string;
  if (recover) {
    childId = recover.childId;
  } else {
    const child = await actions.createOwnChild();
    if (!child?.id) {
      throw new Error("Child creation could not be confirmed. Check your children list before retrying.");
    }
    childId = child.id;
  }
  const needsName = recover ? recover.needsName : true;
  const needsTeam = recover ? recover.needsTeam : true;
  // After the child exists, every subsequent failure is a PARTIAL SUCCESS.
  // Try each independent follow-up once; never lose the child ID or retry the
  // non-idempotent create call. Promise.resolve also protects against a
  // synchronous failure preventing the second attempt.
  const [nameResult, teamResult] = await Promise.allSettled([
    needsName ? Promise.resolve().then(() => actions.saveName(childId)) : Promise.resolve(),
    needsTeam ? Promise.resolve().then(() => actions.assignOwnChildToTeam(childId)) : Promise.resolve(),
  ]);
  // Never print a PII failure or the child's plaintext name in logs.
  const nameSaved = nameResult.status === "fulfilled";
  const teamLinked = teamResult.status === "fulfilled";
  if (!teamLinked) return { status: "created_unlinked", childId, nameSaved };
  if (!nameSaved) return { status: "linked_without_name", childId };
  return recover ? { status: "linked", childId, recovered: true } : { status: "linked", childId };
}
