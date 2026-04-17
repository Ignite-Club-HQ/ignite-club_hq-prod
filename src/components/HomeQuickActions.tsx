import { UserPlus, Users, Plus } from "lucide-react";

interface HomeQuickActionsProps {
  onCreateTeam: () => void;
  onInvite: () => void;
  onJoinTeam: () => void;
  hasTeams: boolean;
}

export function HomeQuickActions({ onCreateTeam, onInvite, onJoinTeam, hasTeams }: HomeQuickActionsProps) {
  const actions = [
    {
      label: "Invite to Team",
      description: "Send a link to players, parents & coaches",
      icon: UserPlus,
      onClick: onInvite,
      show: hasTeams,
    },
    {
      label: "Join a Team",
      description: "Use an invite link to join a team",
      icon: Users,
      onClick: onJoinTeam,
      show: true,
    },
    {
      label: "Create Team",
      description: "Start a new team or class",
      icon: Plus,
      onClick: onCreateTeam,
      show: true,
    },
  ].filter(a => a.show);

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5 px-0.5">Team Actions</p>
      <div className="grid grid-cols-3 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="flex flex-col items-center gap-2 py-3.5 px-2 rounded-xl border border-border bg-card hover:bg-accent/50 active:bg-accent active:scale-[0.98] transition-all text-center min-h-[80px] touch-manipulation select-none cursor-pointer"
          >
            <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted pointer-events-none">
              <action.icon className="h-4.5 w-4.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 pointer-events-none">
              <p className="text-xs font-medium text-foreground leading-tight">
                {action.label}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
