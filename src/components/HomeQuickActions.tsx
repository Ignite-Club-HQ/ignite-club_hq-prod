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
      label: "Invite",
      icon: UserPlus,
      onClick: onInvite,
      show: hasTeams,
    },
    {
      label: "Join Team",
      icon: Users,
      onClick: onJoinTeam,
      show: true,
    },
    {
      label: "Create Team",
      icon: Plus,
      onClick: onCreateTeam,
      show: true,
    },
  ].filter(a => a.show);

  return (
    <section className="px-1">
      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-card/60 hover:bg-accent/40 active:bg-accent active:scale-[0.97] transition-all text-xs font-medium text-foreground touch-manipulation select-none cursor-pointer"
          >
            <action.icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
