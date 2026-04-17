import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Eye, Bell, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Smartphone, Mail, ChevronDown } from "lucide-react";
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
  /** Total members who could view this event (used to compute "X viewed · Y not opened") */
  trackableMembersCount?: number;
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
  const [open, setOpen] = useState(false);
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
  const notViewedCount = useMemo(() => {
    if (typeof trackableMembersCount !== "number") return 0;
    return Math.max(trackableMembersCount - viewedCount, 0);
  }, [trackableMembersCount, viewedCount]);

  const totalResponses = counts.going + counts.maybe + counts.notGoing;
  const allResponded = hasMembers && counts.notResponded === 0;
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

  return (
    <section className="space-y-2">
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Attendance</h2>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>

          {noOneInvited ? (
            <div>
              <p className="text-sm font-medium">No responses yet</p>
              <p className="text-xs text-muted-foreground">Invite members or send a reminder</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <AttendanceChip tone="going" label="Going" count={counts.going} />
                <AttendanceChip tone="maybe" label="Maybe" count={counts.maybe} />
                <AttendanceChip tone="notGoing" label="Not Going" count={counts.notGoing} />
                {counts.notResponded > 0 && (
                  <AttendanceChip tone="noResponse" label="No Response" count={counts.notResponded} />
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {allResponded
                    ? "Everyone has responded"
                    : isAdmin
                      ? "View all & send reminders"
                      : "Tap to view all"}
                </p>
                {isAdmin && viewedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Eye className="h-3 w-3" />
                    {viewedCount} viewed
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle>Attendance</DrawerTitle>
            <DrawerDescription>
              {totalResponses} response{totalResponses === 1 ? "" : "s"}
              {counts.notResponded > 0 && ` · ${counts.notResponded} not yet responded`}
            </DrawerDescription>
          </DrawerHeader>

          <div className="overflow-y-auto px-4 pb-6 space-y-5">
            {/* Reminder actions — only show when there are non-responders an admin can nudge */}
            {isAdmin && canSendReminders && counts.notResponded > 0 && notRespondedUserIds.length > 0 && (
              <div className="flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-2 -mx-4 px-4 border-b z-10">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" disabled={isSending} className="gap-1.5 flex-1 sm:flex-none">
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Bell className="h-4 w-4" />
                      )}
                      Remind non-responders
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
              </div>
            )}

            {/* Going */}
            <AttendanceGroup
              icon="✅"
              label="Going"
              count={counts.going}
              tone="going"
              emptyHint="No one yet"
            >
              {goingContent}
            </AttendanceGroup>

            {counts.maybe > 0 && (
              <>
                <Separator />
                <AttendanceGroup icon="🤔" label="Maybe" count={counts.maybe} tone="maybe">
                  {maybeContent}
                </AttendanceGroup>
              </>
            )}

            {counts.notGoing > 0 && (
              <>
                <Separator />
                <AttendanceGroup icon="❌" label="Not Going" count={counts.notGoing} tone="notGoing">
                  {notGoingContent}
                </AttendanceGroup>
              </>
            )}

            {counts.notResponded > 0 && (
              <>
                <Separator />
                <AttendanceGroup
                  icon="⏳"
                  label="No Response"
                  count={counts.notResponded}
                  tone="noResponse"
                >
                  {notRespondedContent}
                </AttendanceGroup>
              </>
            )}

            {/* De-prioritised view stats */}
            {isAdmin && (viewedCount > 0 || notViewedCount > 0) && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  {viewedCount} viewed
                  {notViewedCount > 0 && ` · ${notViewedCount} not opened`}
                </p>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
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
  icon,
  label,
  count,
  tone,
  emptyHint,
  children,
}: {
  icon: string;
  label: string;
  count: number;
  tone: Tone;
  emptyHint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className={cn("flex items-center gap-2 text-sm font-semibold", toneStyles[tone].header)}>
        <span aria-hidden>{icon}</span>
        <span>
          {label} ({count})
        </span>
      </div>
      {count === 0 && emptyHint ? (
        <p className="text-muted-foreground text-sm pl-6">{emptyHint}</p>
      ) : (
        <div className="pl-1">{children}</div>
      )}
    </div>
  );
}
