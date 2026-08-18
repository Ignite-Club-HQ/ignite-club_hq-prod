import { forwardRef } from "react";
import { Pencil, User } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { TeamRole, TeamRoleOption } from "@/features/membership/invitationPolicy";

interface SingleInvitationRoleStepProps {
  wizardStep: 1 | 2 | 3;
  personName: string;
  isExistingUser: boolean;
  selectedRole: TeamRole;
  roleOptions: readonly TeamRoleOption[];
  onEditPerson: () => void;
  onEditRole: () => void;
  onRoleChange: (role: TeamRole) => void;
}

export const SingleInvitationRoleStep = forwardRef<HTMLDivElement, SingleInvitationRoleStepProps>(
  function SingleInvitationRoleStep({
    wizardStep,
    personName,
    isExistingUser,
    selectedRole,
    roleOptions,
    onEditPerson,
    onEditRole,
    onRoleChange,
  }, roleSectionRef) {
    const roleLabel = roleOptions.find((option) => option.value === selectedRole)?.label || selectedRole;

    return (
      <>
        {wizardStep > 1 && personName && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <button
              type="button"
              onClick={onEditPerson}
              className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-border bg-muted/50 hover:bg-muted px-2 py-1 text-xs transition-colors"
              aria-label="Edit selected person"
            >
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{personName}</span>
              {!isExistingUser && (
                <span className="text-[10px] uppercase tracking-wide text-primary/80 font-semibold shrink-0">New</span>
              )}
              <Pencil className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
            </button>
            {wizardStep > 2 && (
              <button
                type="button"
                onClick={onEditRole}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 hover:bg-primary/15 px-2 py-1 text-xs text-primary transition-colors"
                aria-label="Edit selected role"
              >
                <span className="font-medium">{roleLabel}</span>
                <Pencil className="h-2.5 w-2.5 shrink-0" />
              </button>
            )}
          </div>
        )}

        {wizardStep === 2 && (
          <div className="space-y-2 scroll-mt-4" ref={roleSectionRef}>
            <Label className="text-sm font-medium">Select role</Label>
            <div className={`grid gap-2 ${roleOptions.length <= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {roleOptions.map((option) => (
                <button
                  key={`top-${option.value}`}
                  type="button"
                  role="radio"
                  aria-checked={selectedRole === option.value}
                  aria-pressed={selectedRole === option.value}
                  aria-label={`Role: ${option.label}`}
                  onClick={() => onRoleChange(option.value)}
                  className={`p-3 rounded-xl text-center transition-all border ${
                    selectedRole === option.value
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-muted/40 hover:bg-muted text-foreground"
                  }`}
                >
                  <p className="text-sm font-medium">
                    {option.value === "parent" ? "Parent" : option.value === "coach" ? "Coach" : option.value === "team_admin" ? "Admin" : option.label}
                  </p>
                  {option.value === "parent" && (
                    <p className={`text-[11px] mt-0.5 ${selectedRole === option.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      adds child player
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  },
);
