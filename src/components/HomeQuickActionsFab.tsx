import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  UserPlus,
  Users,
  Trophy,
  Calendar,
  MessageCircle,
  Users2,
  Building2,
} from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { CreateActionButton } from "@/components/CreateActionButton";
import { Separator } from "@/components/ui/separator";

interface HomeQuickActionsFabProps {
  onInvite: () => void;
  onJoinTeam: () => void;
  hasTeams: boolean;
  activeClubFilter?: string | null;
  activeClubName?: string | null;
}

type ActionItem = {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  show?: boolean;
  tone?: "default" | "muted";
};

export function HomeQuickActionsFab({
  onInvite,
  onJoinTeam,
  hasTeams,
  activeClubFilter,
  activeClubName,
}: HomeQuickActionsFabProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const close = () => setOpen(false);
  const go = (path: string) => {
    close();
    navigate(path);
  };

  // Primary — highest-frequency, everyday actions
  const primary: ActionItem[] = [
    { label: "New Message", icon: MessageCircle, onClick: () => go("/messages?new=picker") },
    { label: "New Event", icon: Calendar, onClick: () => go("/events/new") },
  ];

  // Secondary — common membership actions
  const secondary: ActionItem[] = [
    { label: "Invite Members", icon: UserPlus, onClick: () => { close(); onInvite(); }, show: hasTeams },
    { label: "Join Team", icon: Users, onClick: () => { close(); onJoinTeam(); } },
  ].filter((i) => i.show !== false);

  // Admin — less frequent, structural actions
  const admin: ActionItem[] = [
    { label: "Create Team", icon: Users2, onClick: () => go("/teams/new"), tone: "muted" },
    { label: "Create Competition", icon: Trophy, onClick: () => go("/competitions/new"), tone: "muted" },
    { label: "Create Association", icon: Building2, onClick: () => go("/associations/new"), tone: "muted" },
  ];

  const renderRow = (item: ActionItem) => (
    <button
      key={item.label}
      type="button"
      onClick={item.onClick}
      className="flex items-center gap-3 w-full min-h-[52px] px-3 rounded-xl hover:bg-accent/50 active:bg-accent transition-colors text-left touch-manipulation"
    >
      <span
        className={
          item.tone === "muted"
            ? "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0"
            : "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0"
        }
      >
        <item.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="text-[15px] font-medium text-foreground truncate">{item.label}</span>
    </button>
  );

  return (
    <>
      <CreateActionButton ariaLabel="Quick actions" onClick={() => setOpen(true)} />

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Quick Actions</ResponsiveDialogTitle>
            {activeClubName && (
              <p className="text-sm text-muted-foreground -mt-1">{activeClubName}</p>
            )}
          </ResponsiveDialogHeader>

          <div className="px-2 pb-6 pt-1 space-y-1">
            {primary.map(renderRow)}
            {secondary.length > 0 && (
              <>
                <div className="py-1">
                  <Separator />
                </div>
                {secondary.map(renderRow)}
              </>
            )}
            {admin.length > 0 && (
              <>
                <div className="py-1">
                  <Separator />
                </div>
                {admin.map(renderRow)}
              </>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
