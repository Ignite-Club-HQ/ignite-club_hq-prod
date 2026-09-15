import { AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TeamRole } from "@/features/membership/invitationPolicy";

interface SingleInvitationWizardFooterProps {
  wizardStep: 1 | 2 | 3;
  hasMemberIdentity: boolean;
  hasMemberName: boolean;
  selectedRole: TeamRole;
  hasNamedChild: boolean;
  deliveryMethod: "email" | "share";
  email: string;
  isPending: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export function SingleInvitationWizardFooter({
  wizardStep,
  hasMemberIdentity,
  hasMemberName,
  selectedRole,
  hasNamedChild,
  deliveryMethod,
  email,
  isPending,
  onBack,
  onNext,
  onSubmit,
}: SingleInvitationWizardFooterProps) {
  const canAdvanceFromStep1 = hasMemberIdentity || hasMemberName;
  const canAdvanceFromStep2 = selectedRole !== "parent" || hasNamedChild;
  const isFinalStep = wizardStep === 3 || (wizardStep === 2 && hasMemberIdentity && selectedRole !== "parent");
  const emailTrimmed = email.trim();
  const needsEmail = isFinalStep && deliveryMethod === "email" && !hasMemberIdentity && !emailTrimmed;
  const hasInvalidEmail = isFinalStep
    && deliveryMethod === "email"
    && !hasMemberIdentity
    && !!emailTrimmed
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);

  let blockedReason: string | null = null;
  if (wizardStep === 2 && !canAdvanceFromStep2) {
    blockedReason = "Add at least one child's name to continue.";
  } else if (needsEmail) {
    blockedReason = "Enter an email address to send the invite.";
  } else if (hasInvalidEmail) {
    blockedReason = "That email doesn't look right — double-check the format.";
  }

  const nextDisabled =
    (wizardStep === 1 && !canAdvanceFromStep1)
    || (wizardStep === 2 && !canAdvanceFromStep2);

  return (
    <div className="space-y-2">
      {blockedReason && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{blockedReason}</span>
        </div>
      )}
      <div className="flex gap-2">
        {wizardStep > 1 && (
          <Button type="button" variant="outline" className="h-12 px-4" disabled={isPending} onClick={onBack}>
            Back
          </Button>
        )}
        {isFinalStep ? (
          <Button
            className="flex-1 h-12 text-base font-semibold"
            onClick={onSubmit}
            disabled={isPending || needsEmail || hasInvalidEmail}
            variant={needsEmail || hasInvalidEmail ? "outline" : "default"}
          >
            {isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />}
            {hasMemberIdentity ? "Add to Team" : "Create Invite"}
          </Button>
        ) : (
          <Button
            className="flex-1 h-12 text-base font-semibold"
            onClick={onNext}
            disabled={nextDisabled}
            variant={nextDisabled ? "outline" : "default"}
          >
            {wizardStep === 1
              ? (canAdvanceFromStep1 ? "Next: Choose role" : "Enter a name to continue")
              : selectedRole === "parent" && !canAdvanceFromStep2
                ? "Add a child to continue"
                : hasMemberIdentity && selectedRole === "parent"
                  ? "Next: Add Children"
                  : "Next: Send"}
          </Button>
        )}
      </div>
    </div>
  );
}
