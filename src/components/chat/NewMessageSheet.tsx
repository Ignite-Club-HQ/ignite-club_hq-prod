import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MessageCircle, Users, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateGroups: boolean;
  onPickDM: () => void;
  onPickGroup: () => void;
}

interface ActionRowProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  accent: "primary" | "violet";
  onClick: () => void;
}

function ActionRow({ icon: Icon, title, subtitle, accent, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 rounded-2xl p-4 text-left",
        "bg-card border border-border",
        "active:scale-[0.985] transition-transform touch-manipulation",
        "hover:border-primary/40 hover:bg-accent/30"
      )}
    >
      <div
        className={cn(
          "h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center",
          accent === "primary" && "bg-primary/15 text-primary",
          accent === "violet" && "bg-violet-500/15 text-violet-400"
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </button>
  );
}

export function NewMessageSheet({
  open,
  onOpenChange,
  canCreateGroups,
  onPickDM,
  onPickGroup,
}: NewMessageSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        enableDragToClose
        hideCloseButton
        className="rounded-t-3xl border-t border-border bg-background p-0 max-h-[85vh]"
      >
        <div className="px-5 pt-1 pb-5">
          <SheetHeader className="text-left pb-4">
            <SheetTitle className="text-xl">New message</SheetTitle>
            <SheetDescription className="text-xs">
              Pick how you want to start
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2.5">
            <ActionRow
              icon={MessageCircle}
              title="New Direct Message"
              subtitle="Message one person, or several at once"
              accent="primary"
              onClick={() => {
                onOpenChange(false);
                onPickDM();
              }}
            />
            {canCreateGroups && (
              <ActionRow
                icon={Users}
                title="New Group Chat"
                subtitle="Role, team or custom group"
                accent="violet"
                onClick={() => {
                  onOpenChange(false);
                  onPickGroup();
                }}
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
