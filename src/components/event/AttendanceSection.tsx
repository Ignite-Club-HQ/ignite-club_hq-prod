import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, Eye, Smartphone, Mail, ChevronDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AttendanceCounts {
  going: number;
  maybe: number;
  notGoing: number;
  notResponded: number;
}

interface AttendanceSectionProps {
  eventId: string;
  isAdmin: boolean;
  /** Whether the event has any addressable members at all (drives empty state copy) */
  hasMembers: boolean;
  counts: AttendanceCounts;
  /** Pre-rendered attendee rows for each bucket, supplied by the parent so we
   *  reuse all of its existing AttendeeCard / admin-action wiring. */
  goingContent: ReactNode;
  maybeContent: ReactNode;
  notGoingContent: ReactNode;
  notRespondedContent: ReactNode;
  /** IDs of members who have NOT responded — used to send batched reminders */
  notRespondedUserIds: string[];
  canSendReminders: boolean;
  /** Total members who could view this event (used to compute "X viewed") */
  trackableMembersCount?: number;
  /** Optional: open the native/web share sheet with a copyable RSVP link */
  onShareLink?: () => void;
}

export function AttendanceSection({
  eventId,
  isAdmin,
  hasMembers,
  counts,
  goingContent,
  maybeContent,
  notGoingContent,
  notRespondedContent,
  notRespondedUserIds,
  canSendReminders,
  trackableMembersCount,
}: AttendanceSectionProps) {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);

  // Lightweight view-count fetch; only when admin (others don't need it)
  const { data: eventViews } = useQuery({
    queryKey: ["event-views-summary", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select("user_id")
        .eq("event_id", eventId);
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const viewedCount = eventViews?.length ?? 0;

  const totalResponses = counts.going + counts.maybe + counts.notGoing;
  const noOneInvited = !hasMembers && totalResponses === 0;

  const handleSendReminders = async (channels: "push" | "email" | "both") => {
    if (notRespondedUserIds.length === 0) return;
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-event-view-reminder",
        {
          body: {
            eventId,
            userIds: notRespondedUserIds,
            channels,
          },
        },
      );
      if (error) throw error;
      const parts: string[] = [];
      if (data?.emailsSent > 0) parts.push(`${data.emailsSent} email${data.emailsSent === 1 ? "" : "s"}`);
      if (data?.pushSent > 0) parts.push(`${data.pushSent} push notification${data.pushSent === 1 ? "" : "s"}`);
      toast({
        title: "Reminders sent",
        description: parts.length ? `Sent ${parts.join(" and ")}.` : "No reminders could be delivered.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to send reminders",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const showReminderAction =
    isAdmin && canSendReminders && counts.notResponded > 0 && notRespondedUserIds.length > 0;

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Team Attendance</h2>
        {isAdmin && viewedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" />
            {viewedCount} viewed
          </span>
        )}
      </div>

      {noOneInvited ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-sm font-medium">No responses yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Invite members or send a reminder
          </p>
        </div>
      ) : (
        <>
          {/* Status summary chips */}
          <div className="flex flex-wrap gap-1.5">
            <AttendanceChip tone="going" label="Going" count={counts.going} />
            <AttendanceChip tone="maybe" label="Maybe" count={counts.maybe} />
            <AttendanceChip tone="notGoing" label="Not Going" count={counts.notGoing} />
            <AttendanceChip tone="noResponse" label="No Response" count={counts.notResponded} />
          </div>

          {/* Top-level reminder action */}
          {showReminderAction && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={isSending} className="gap-1.5 w-full sm:w-auto">
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                  Remind all non-responders
                  <ChevronDown className="h-3 w-3 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleSendReminders("push")}>
                  <Smartphone className="h-4 w-4 mr-2" />
                  Push Notification
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSendReminders("email")}>
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSendReminders("both")}>
                  <Bell className="h-4 w-4 mr-2" />
                  Both (Push + Email)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Full member list — always visible, grouped by status */}
          <div className="space-y-5">
            {counts.going > 0 && (
              <AttendanceGroup label="Going" count={counts.going} tone="going">
                {goingContent}
              </AttendanceGroup>
            )}

            {counts.maybe > 0 && (
              <AttendanceGroup label="Maybe" count={counts.maybe} tone="maybe">
                {maybeContent}
              </AttendanceGroup>
            )}

            {counts.notGoing > 0 && (
              <AttendanceGroup label="Not Going" count={counts.notGoing} tone="notGoing">
                {notGoingContent}
              </AttendanceGroup>
            )}

            {counts.notResponded > 0 && (
              <AttendanceGroup label="No Response" count={counts.notResponded} tone="noResponse">
                {notRespondedContent}
              </AttendanceGroup>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type Tone = "going" | "maybe" | "notGoing" | "noResponse";

const toneStyles: Record<Tone, { chip: string; header: string; icon: string }> = {
  going: {
    chip: "bg-primary/10 text-primary border-primary/20",
    header: "text-primary",
    icon: "✅",
  },
  maybe: {
    chip: "bg-warning/10 text-warning border-warning/20",
    header: "text-warning",
    icon: "🤔",
  },
  notGoing: {
    chip: "bg-destructive/10 text-destructive border-destructive/20",
    header: "text-destructive",
    icon: "❌",
  },
  noResponse: {
    chip: "bg-muted text-muted-foreground border-border",
    header: "text-muted-foreground",
    icon: "⏳",
  },
};

function AttendanceChip({
  tone,
  label,
  count,
}: {
  tone: Tone;
  label: string;
  count: number;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium gap-1",
        toneStyles[tone].chip,
      )}
    >
      <span aria-hidden>{toneStyles[tone].icon}</span>
      <span>{label}</span>
      <span className="font-semibold">{count}</span>
    </Badge>
  );
}

function AttendanceGroup({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count: number;
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          toneStyles[tone].header,
        )}
      >
        <span aria-hidden>{toneStyles[tone].icon}</span>
        <span>
          {label} ({count})
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}
