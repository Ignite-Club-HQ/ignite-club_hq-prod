import type { ExistingClubChildInput } from "./membershipMutationService";
import {
  processBulkExistingRecipient,
  processBulkPendingRecipient,
  type BulkPendingRecipientResult,
} from "./membershipMutationService";
import {
  buildBulkPendingInviteMetadata,
  planBulkInvitations,
  type BulkInvitationPlanningMember,
} from "./bulkInvitationPlanner";
import type { TeamRole } from "./invitationPolicy";

export interface BulkInvitationWorkflowMember extends BulkInvitationPlanningMember {
  email: string;
  selectedUser?: {
    id: string;
    display_name: string | null;
  } | null;
}

export interface BulkInvitationWorkflowFailure {
  memberName: string;
  error: unknown;
}

export interface BulkInvitationWorkflowResult {
  results: BulkPendingRecipientResult[];
  failures: BulkInvitationWorkflowFailure[];
}

type WorkflowOperations = {
  processExisting: typeof processBulkExistingRecipient;
  processPending: typeof processBulkPendingRecipient;
};

export async function processBulkInvitationBatch<T extends BulkInvitationWorkflowMember>(
  members: T[],
  context: {
    teamId: string;
    teamName: string;
    clubId: string;
    inviterUserId: string;
    roleLabel: (role: TeamRole) => string | undefined;
    clubChildren: ExistingClubChildInput[];
    customMessage: string;
    appOrigin: string;
    clubName: string | null | undefined;
    clubLogoUrl: string | null | undefined;
    clubContactEmail: string | null | undefined;
  },
  operations: WorkflowOperations = {
    processExisting: processBulkExistingRecipient,
    processPending: processBulkPendingRecipient,
  },
): Promise<BulkInvitationWorkflowResult> {
  const plans = planBulkInvitations(members);
  const results: BulkPendingRecipientResult[] = [];
  const failures: BulkInvitationWorkflowFailure[] = [];

  for (const { member, inviteToken, linkedInviteToken } of plans) {
    const { validChildren, metadata } = buildBulkPendingInviteMetadata(member, linkedInviteToken);
    if (member.selectedUser) {
      const outcome = await operations.processExisting({
        userId: member.selectedUser.id,
        displayName: member.selectedUser.display_name,
        enteredName: member.name,
        enteredEmail: member.email,
        teamId: context.teamId,
        teamName: context.teamName,
        clubId: context.clubId,
        inviterUserId: context.inviterUserId,
        role: member.role,
        roleLabel: context.roleLabel(member.role),
        children: validChildren,
        clubChildren: context.clubChildren,
        selectedSecondGuardian: member.selectedSecondParent ?? null,
        secondGuardianName: member.secondParentName ?? "",
        secondGuardianEmail: member.secondParentEmail ?? "",
        appOrigin: context.appOrigin,
        clubName: context.clubName,
        clubLogoUrl: context.clubLogoUrl,
        clubContactEmail: context.clubContactEmail,
      });
      if (outcome.memberResult) results.push(outcome.memberResult);
      else failures.push({ memberName: member.name, error: outcome.roleResult.error });
      continue;
    }

    const outcome = await operations.processPending({
      teamId: context.teamId,
      teamName: context.teamName,
      clubId: context.clubId,
      inviterUserId: context.inviterUserId,
      role: member.role,
      roleLabel: context.roleLabel(member.role) ?? "Member",
      invitedName: member.name,
      invitedEmail: member.email,
      inviteToken,
      metadata,
      childrenNames: validChildren.map((child) => child.name.trim()),
      customMessage: context.customMessage,
      appOrigin: context.appOrigin,
      clubName: context.clubName,
      clubLogoUrl: context.clubLogoUrl,
      clubContactEmail: context.clubContactEmail,
    });
    if (outcome.memberResult) results.push(outcome.memberResult);
    else failures.push({ memberName: member.name, error: outcome.inviteError });
  }

  return { results, failures };
}
