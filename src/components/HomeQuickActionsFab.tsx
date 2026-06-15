import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, UserPlus, Users, Trophy, Calendar, MessageCircle } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface HomeQuickActionsFabProps {
  onInvite: () => void;
  onJoinTeam: () => void;
  hasTeams: boolean;
}

type ActionItem = {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  show?: boolean;
};

type ActionGroup = { heading: string; items: ActionItem[] };

export function HomeQuickActionsFab({ onInvite, onJoinTeam, hasTeams }: HomeQuickActionsFabProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const close = () => setOpen(false);

  const go = (path: string) => {
    close();
    navigate(path);
  };



  const groups: ActionGroup[] = [
    {
      heading: "Invite",
      items: [
        { label: "Invite Members", icon: UserPlus, onClick: () => { close(); onInvite(); }, show: hasTeams },
      ],
    
    },
    {
      heading: "Join",
      items: [
        { label: "Join Team", icon: Users, onClick: () => { close(); onJoinTeam(); } },
      ],
    },
    {
      heading: "Create",
      items: [
        { label: "Create Message", icon: MessageCircle, onClick: () => go("/messages?new=picker") },
        { label: "Create Event", icon: Calendar, onClick: () => go("/events/new") },
        { label: "Create Team", icon: Users, onClick: () => go("/start") },
        { label: "Create Competition", icon: Trophy, onClick: () => go("/competitions/new") },
      ],
    },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Quick actions"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 active:scale-95 transition-all touch-manipulation select-none cursor-pointer shrink-0"
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Quick Actions</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="px-4 pb-6 pt-2 space-y-5">
            {groups.map((group) => {
              const visible = group.items.filter((i) => i.show !== false);
              if (visible.length === 0) return null;
              return (
                <div key={group.heading} className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground px-1">
                    {group.heading}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {visible.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={item.onClick}
                        className="flex items-center gap-3 h-12 px-3 rounded-lg border border-border bg-card hover:bg-accent/50 active:bg-accent transition-colors text-sm font-medium text-foreground touch-manipulation text-left"
                      >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                          <item.icon className="h-4 w-4" />
                        </span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

    </>
  );
}
