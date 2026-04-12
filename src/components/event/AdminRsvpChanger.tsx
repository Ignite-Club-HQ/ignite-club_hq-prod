import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

type RsvpStatus = "going" | "maybe" | "not_going";

const statusConfig: Record<RsvpStatus, { label: string; icon: string; badgeClass: string }> = {
  going: {
    label: "Going",
    icon: "✅",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
  },
  maybe: {
    label: "Maybe",
    icon: "🤔",
    badgeClass: "border-warning/40 bg-warning/10 text-warning",
  },
  not_going: {
    label: "Can't Go",
    icon: "❌",
    badgeClass: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

const allStatuses: RsvpStatus[] = ["going", "maybe", "not_going"];

interface AdminRsvpChangerProps {
  currentStatus: RsvpStatus | null;
  playerName: string;
  onChangeStatus: (status: RsvpStatus) => void;
  isPending?: boolean;
}

/**
 * Displays current RSVP status with a "Change" action that opens a bottom sheet.
 * For "not responded" entries, shows a "Set Status" button instead.
 * Makes it clear the admin is editing another person's response.
 */
export function AdminRsvpChanger({
  currentStatus,
  playerName,
  onChangeStatus,
  isPending,
}: AdminRsvpChangerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (status: RsvpStatus) => {
    onChangeStatus(status);
    setOpen(false);
  };

  // No current status — show "Set Status" button
  if (!currentStatus) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1 h-7"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set Status"}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-base">
              Set RSVP for {playerName}
            </DrawerTitle>
            <p className="text-sm text-muted-foreground">
              You are setting this response as an admin
            </p>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-2">
            {allStatuses.map((status) => {
              const config = statusConfig[status];
              return (
                <Button
                  key={status}
                  variant="outline"
                  className="w-full justify-start gap-3 h-12 text-base"
                  onClick={() => handleSelect(status)}
                  disabled={isPending}
                >
                  <span className="text-lg">{config.icon}</span>
                  {config.label}
                </Button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Has current status — show status badge + "Change" button
  const config = statusConfig[currentStatus];

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          className="flex items-center gap-1.5 shrink-0 group"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors underline underline-offset-2">
              Change
            </span>
          )}
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">
            Change RSVP for {playerName}
          </DrawerTitle>
          <p className="text-sm text-muted-foreground">
            You are editing this response as an admin
          </p>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-2">
          {allStatuses.map((status) => {
            const opt = statusConfig[status];
            const isActive = status === currentStatus;
            return (
              <Button
                key={status}
                variant={isActive ? "secondary" : "outline"}
                className={`w-full justify-start gap-3 h-12 text-base ${isActive ? "ring-2 ring-primary/30" : ""}`}
                onClick={() => !isActive && handleSelect(status)}
                disabled={isPending || isActive}
              >
                <span className="text-lg">{opt.icon}</span>
                {opt.label}
                {isActive && (
                  <span className="ml-auto text-xs text-muted-foreground">Current</span>
                )}
              </Button>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
