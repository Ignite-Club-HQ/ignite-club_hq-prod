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
import {
  ensureSecondParent,
  secondParentValidationError,
} from "./secondParentInvite";

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
    inviteEmailStyle?: string | null;
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
    const secondParentError = secondParentValidationError({
      role: member.role,
      name: member.secondParentName ?? "",
      email: member.secondParentEmail ?? "",
      selectedProfile: member.selectedSecondParent ?? null,
    });
    if (secondParentError) {
      failures.push({ memberName: member.name, error: new Error(secondParentError) });
      continue;
    }
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
        children: validChildren.map((child) => ({
          name: child.name,
          yearOfBirth: child.yearOfBirth ?? "",
          jerseyNumber: child.jerseyNumber ?? "",
          existingChildId: child.existingChildId,
        })),
        clubChildren: context.clubChildren,
        selectedSecondGuardian: member.selectedSecondParent ?? null,
        secondGuardianName: member.secondParentName ?? "",
        secondGuardianEmail: member.secondParentEmail ?? "",
        appOrigin: context.appOrigin,
        clubName: context.clubName,
        clubLogoUrl: context.clubLogoUrl,
        clubContactEmail: context.clubContactEmail,
        inviteEmailStyle: context.inviteEmailStyle,
      });
      if (outcome.memberResult) {
        results.push(outcome.memberResult);
        if (member.selectedSecondParent || member.secondParentName?.trim()) {
          try {
            await ensureSecondParent({
              role: member.role,
              teamId: context.teamId,
              clubId: context.clubId,
              name: member.secondParentName ?? "",
              email: member.secondParentEmail ?? "",
              selectedProfile: member.selectedSecondParent ?? null,
              childrenMetadata: validChildren.map((child) => ({
                name: child.name,
                yearOfBirth: child.yearOfBirth ? Number(child.yearOfBirth) : null,
                existingChildId: child.existingChildId ?? null,
              })),
              expectChildren: validChildren.length > 0,
              invitedByUserId: context.inviterUserId,
              origin: context.appOrigin,
            });
          } catch (error) {
            failures.push({ memberName: member.secondParentName || member.name, error });
          }
        }
      }
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
      inviteEmailStyle: context.inviteEmailStyle,
    });
    if (outcome.memberResult) {
      results.push(outcome.memberResult);
      if (member.selectedSecondParent || member.secondParentName?.trim()) {
        try {
          await ensureSecondParent({
            role: member.role,
            teamId: context.teamId,
            clubId: context.clubId,
            name: member.secondParentName ?? "",
            email: member.secondParentEmail ?? "",
            selectedProfile: member.selectedSecondParent ?? null,
            childrenMetadata: validChildren.map((child) => ({
              name: child.name,
              yearOfBirth: child.yearOfBirth ? Number(child.yearOfBirth) : null,
              existingChildId: child.existingChildId ?? null,
            })),
            expectChildren: validChildren.length > 0,
            invitedByUserId: context.inviterUserId,
            linkedInviteToken: inviteToken,
            origin: context.appOrigin,
          });
        } catch (error) {
          failures.push({ memberName: member.secondParentName || member.name, error });
        }
      }
    }
    else failures.push({ memberName: member.name, error: outcome.inviteError });
  }

  return { results, failures };
}
