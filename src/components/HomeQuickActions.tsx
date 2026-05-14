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
      label: "Join",
      icon: Users,
      onClick: onJoinTeam,
      show: true,
    },
    {
      label: "Create",
      icon: Plus,
      onClick: onCreateTeam,
      show: true,
    },
  ].filter(a => a.show);

  return (
    <section className="px-1">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-2 rounded-full border border-border bg-card/60 hover:bg-accent/40 active:bg-accent active:scale-[0.97] transition-all text-xs font-medium text-foreground touch-manipulation select-none cursor-pointer"
          >
            <action.icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
