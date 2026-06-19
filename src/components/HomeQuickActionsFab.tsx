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
  ChevronRight,
  ChevronLeft,
  SlidersHorizontal,
  ImagePlus,
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
  canCreateTeam?: boolean;
  canCreateEvent?: boolean;
  activeClubFilter?: string | null;
  activeClubName?: string | null;
}

type ActionItem = {
  label: string;
  description?: string;
  icon: typeof Plus;
  onClick: () => void;
};

export function HomeQuickActionsFab({
  onInvite,
  onJoinTeam,
  hasTeams,
  canCreateTeam = false,
  canCreateEvent = false,
  activeClubFilter,
  activeClubName,
}: HomeQuickActionsFabProps) {

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "more">("main");
  const navigate = useNavigate();

  const close = () => setOpen(false);
  const go = (path: string) => {
    close();
    navigate(path);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) setView("main");
  };

  // Primary — 5 highest-frequency actions
  const primary: ActionItem[] = [
    {
      label: "New Message",
      icon: MessageCircle,
      onClick: () => go("/messages?new=picker"),
    },
    {
      label: "Post Media",
      icon: ImagePlus,
      onClick: () => go("/media?upload=1"),
    },
    ...(canCreateEvent
      ? [
          {
            label: "New Event",
            icon: Calendar,
            onClick: () => go("/events/new"),
          } as ActionItem,
        ]
      : []),
    ...(hasTeams
      ? [
          {
            label: "Invite Members",
            icon: UserPlus,
            onClick: () => {
              close();
              onInvite();
            },
          } as ActionItem,
        ]
      : []),
    {
      label: "Join or Request Team Role",
      description: "Join a team or request Coach / Admin access",
      icon: Users,
      onClick: () => {
        close();
        onJoinTeam();
      },
    },
    ...(canCreateTeam
      ? [
          {
            label: "Create Team",
            icon: Users2,
            onClick: () => go("/teams/new"),
          } as ActionItem,
        ]
      : []),
  ];


  // More — low-frequency administrative actions
  const more: ActionItem[] = [
    {
      label: "Create Competition",
      icon: Trophy,
      onClick: () => go("/competitions/new"),
    },
    ...(!activeClubFilter
      ? [
          {
            label: "Create Association",
            icon: Building2,
            onClick: () => go("/associations/new"),
          } as ActionItem,
        ]
      : []),
  ];

  const PrimaryRow = ({ item }: { item: ActionItem }) => (
    <button
      key={item.label}
      type="button"
      onClick={item.onClick}
      className="flex items-center gap-3 w-full min-h-[48px] px-3 py-2 rounded-xl hover:bg-accent/50 active:bg-accent active:scale-[0.98] transition-all text-left touch-manipulation"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
        <item.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-foreground truncate">
          {item.label}
        </span>
        {item.description && (
          <span className="block text-[12px] text-muted-foreground truncate">
            {item.description}
          </span>
        )}
      </span>
    </button>
  );

  const MutedRow = ({ item }: { item: ActionItem }) => (
    <button
      key={item.label}
      type="button"
      onClick={item.onClick}
      className="flex items-center gap-3 w-full min-h-[48px] px-3 rounded-xl hover:bg-accent/50 active:bg-accent active:scale-[0.98] transition-all text-left touch-manipulation"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
        <item.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="text-[15px] font-medium text-foreground/80 truncate">
        {item.label}
      </span>
    </button>
  );

  return (
    <>
      <CreateActionButton ariaLabel="Quick actions" onClick={() => setOpen(true)} />

      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="max-w-md">
          {view === "main" ? (
            <>
              <ResponsiveDialogHeader className="text-left p-4 pb-2">
                <ResponsiveDialogTitle className="text-lg font-semibold tracking-tight">
                  Quick Actions
                </ResponsiveDialogTitle>
                {activeClubName && (
                  <p className="text-sm text-muted-foreground">
                    {activeClubName}
                  </p>
                )}
              </ResponsiveDialogHeader>

              <div className="px-2 pb-6 pt-0 space-y-0">
                {primary.map((item) => (
                  <PrimaryRow key={item.label} item={item} />
                ))}

                <div className="py-2 px-3">
                  <Separator className="bg-border/40" />
                </div>

                <button
                  type="button"
                  onClick={() => setView("more")}
                  className="flex items-center gap-3 w-full min-h-[48px] px-3 rounded-xl hover:bg-accent/50 active:bg-accent active:scale-[0.98] transition-all text-left touch-manipulation"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
                    <SlidersHorizontal className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15px] font-medium text-muted-foreground truncate">
                    More Actions
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </button>
              </div>
            </>
          ) : (
            <>
              <ResponsiveDialogHeader className="text-left p-4 pb-2 flex flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent active:scale-95 transition-all shrink-0 touch-manipulation"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <ResponsiveDialogTitle className="text-lg font-semibold tracking-tight">
                  More Actions
                </ResponsiveDialogTitle>
              </ResponsiveDialogHeader>

              <div className="px-2 pb-6 pt-0 space-y-0">
                {more.map((item) => (
                  <MutedRow key={item.label} item={item} />
                ))}
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
