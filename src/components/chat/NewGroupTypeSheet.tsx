import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Shield, Users, UserPlus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewGroupTypeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickRole: () => void;
  onPickTeam: () => void;
  onPickCustom: () => void;
}

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  accent: "primary" | "violet" | "amber";
  onClick: () => void;
}

function Row({ icon: Icon, title, subtitle, accent, onClick }: RowProps) {
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
          accent === "violet" && "bg-violet-500/15 text-violet-400",
          accent === "amber" && "bg-amber-500/15 text-amber-400"
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

export function NewGroupTypeSheet({
  open,
  onOpenChange,
  onPickRole,
  onPickTeam,
  onPickCustom,
}: NewGroupTypeSheetProps) {
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
            <SheetTitle className="text-xl">New group chat</SheetTitle>
            <SheetDescription className="text-xs">
              Choose who's in it
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2.5">
            <Row
              icon={Shield}
              title="Role-Based Group"
              subtitle="Auto-include everyone with a role (e.g. Coaches)"
              accent="primary"
              onClick={() => { onOpenChange(false); onPickRole(); }}
            />
            <Row
              icon={Users}
              title="Team Group"
              subtitle="Auto-include everyone in a team"
              accent="violet"
              onClick={() => { onOpenChange(false); onPickTeam(); }}
            />
            <Row
              icon={UserPlus}
              title="Custom Group"
              subtitle="Pick people one by one"
              accent="amber"
              onClick={() => { onOpenChange(false); onPickCustom(); }}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
