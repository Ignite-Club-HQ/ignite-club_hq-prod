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
      primary: true,
      show: hasTeams,
    },
    {
      label: "Join with Code",
      description: "Use an invite link or code",
      icon: Users,
      onClick: onJoinTeam,
      primary: false,
      show: true,
    },
    {
      label: "Create Team",
      description: "Start a new team or class",
      icon: Plus,
      onClick: onCreateTeam,
      primary: false,
      show: true,
    },
  ].filter(a => a.show);

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((action, i) => (
        <button
          key={action.label}
          onClick={action.onClick}
          className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
            action.primary
              ? "border-primary/30 bg-primary/5 hover:bg-primary/10 col-span-2"
              : "border-border bg-card hover:bg-accent/50"
          }`}
        >
          <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
            action.primary ? "bg-primary/10" : "bg-muted"
          }`}>
            <action.icon className={`h-4 w-4 ${action.primary ? "text-primary" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-medium ${action.primary ? "text-primary" : "text-foreground"}`}>
              {action.label}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight">{action.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
