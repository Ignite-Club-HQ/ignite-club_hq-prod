import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, Eye, Smartphone, Mail, ChevronDown, Share2, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { EventViewMemberRow } from "@/components/EventViewMemberRow";

interface AttendanceCounts {
  going: number;
  maybe: number;
  notGoing: number;
  notResponded: number;
}

interface AddressableMember {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  roles?: string[] | null;
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
  /** Full addressable member list — enables "viewed/not viewed" breakdown dialog */
  addressableMembers?: AddressableMember[];
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
  addressableMembers,
  onShareLink,
}: AttendanceSectionProps) {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [sendingForUser, setSendingForUser] = useState<string | null>(null);
  const [viewsDialogOpen, setViewsDialogOpen] = useState(false);

  // Lightweight view-count fetch; only when admin (others don't need it)
  const { data: eventViews } = useQuery({
    queryKey: ["event-views-summary", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select("user_id, viewed_at")
        .eq("event_id", eventId);
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const viewedCount = eventViews?.length ?? 0;
  const viewedUserIds = useMemo(
    () => new Set((eventViews || []).map((v: any) => v.user_id)),
    [eventViews],
  );
  const viewedAtMap = useMemo(() => {
    const map = new Map<string, string>();
    (eventViews || []).forEach((v: any) => {
      if (v.viewed_at) map.set(v.user_id, v.viewed_at);
    });
    return map;
  }, [eventViews]);

  // notRespondedUserIds excludes second parents whose child responded — use as source of truth
  const notRespondedSet = useMemo(() => new Set(notRespondedUserIds), [notRespondedUserIds]);

  const { viewedMembers, notViewedMembers } = useMemo(() => {
    const list = addressableMembers || [];
    const viewed = list.filter((m) => viewedUserIds.has(m.id));
    const notViewed = list.filter((m) => !viewedUserIds.has(m.id));
    return { viewedMembers: viewed, notViewedMembers: notViewed };
  }, [addressableMembers, viewedUserIds]);

  const totalResponses = counts.going + counts.maybe + counts.notGoing;
  const noOneInvited = !hasMembers && totalResponses === 0;

  const handleSendReminders = async (
    channels: "push" | "email" | "both",
    userIds?: string[],
  ) => {
    const targets = userIds && userIds.length > 0 ? userIds : notRespondedUserIds;
    if (targets.length === 0) return;
    const isPerUser = !!(userIds && userIds.length === 1);
    if (isPerUser) setSendingForUser(targets[0]);
    else setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-event-view-reminder",
        {
          body: {
            eventId,
            userIds: targets,
            channels,
          },
        },
      );
      if (error) throw error;
      const parts: string[] = [];
      if (data?.emailsSent > 0) parts.push(`${data.emailsSent} email${data.emailsSent === 1 ? "" : "s"}`);
      if (data?.pushSent > 0) parts.push(`${data.pushSent} push notification${data.pushSent === 1 ? "" : "s"}`);
      toast({
        title: "Reminder sent",
        description: parts.length ? `Sent ${parts.join(" and ")}.` : "No reminder could be delivered.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to send reminder",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      if (isPerUser) setSendingForUser(null);
      else setIsSending(false);
    }
  };

  const handleNudgeUser = (_userId: string, displayName: string) => {
    toast({
      title: "Nudge sent",
      description: `${displayName} will be prompted to enable push notifications.`,
    });
  };

  // Sharing a reminder link is always available to admins (no Pro required).
  // Push/email reminders require Pro (canSendReminders).
  const hasNonResponders = counts.notResponded > 0 && notRespondedUserIds.length > 0;
  const showReminderAction = isAdmin && hasNonResponders && (canSendReminders || !!onShareLink);

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Team Attendance</h2>
        {isAdmin && (viewedCount > 0 || (addressableMembers?.length ?? 0) > 0) && (
          <button
            type="button"
            onClick={() => setViewsDialogOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-muted/60 active:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`See who viewed this event: ${viewedCount} viewed`}
          >
            <Eye className="h-3 w-3" />
            <span>{viewedCount} viewed</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Viewed / Not viewed breakdown */}
      <Dialog open={viewsDialogOpen} onOpenChange={setViewsDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader className="text-left">
            <DialogTitle>Event views</DialogTitle>
            <DialogDescription>
              Who has opened this event in the app.
            </DialogDescription>
          </DialogHeader>
          {(addressableMembers?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {viewedCount > 0
                ? `${viewedCount} member${viewedCount === 1 ? "" : "s"} viewed this event.`
                : "No views yet."}
            </div>
          ) : (
            <Tabs defaultValue={notViewedMembers.length > 0 ? "not-viewed" : "viewed"} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="viewed" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Viewed ({viewedMembers.length})
                </TabsTrigger>
                <TabsTrigger value="not-viewed" className="gap-1.5">
                  <EyeOff className="h-3.5 w-3.5" />
                  Not opened ({notViewedMembers.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="viewed" className="flex-1 overflow-y-auto mt-3">
                <ViewerList members={viewedMembers} emptyText="No one has viewed yet." />
              </TabsContent>
              <TabsContent value="not-viewed" className="flex-1 overflow-y-auto mt-3">
                {notViewedMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Everyone has opened this event.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {notViewedMembers.map((m) => {
                      const hasResponded = !notRespondedSet.has(m.id);
                      return (
                        <EventViewMemberRow
                          key={m.id}
                          member={{
                            id: m.id,
                            display_name: m.display_name ?? null,
                            avatar_url: m.avatar_url ?? null,
                            hasViewed: false,
                            hasResponded,
                          }}
                          variant="not-viewed"
                          pushDisabled={false}
                          noPushSetup={false}
                          isBusy={sendingForUser === m.id}
                          onSendReminder={(channels, userIds) =>
                            handleSendReminders(channels, userIds)
                          }
                          onNudge={handleNudgeUser}
                          onShareLink={onShareLink}
                          hasResponded={hasResponded}
                        />
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

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
              <DropdownMenuContent align="start" className="w-56">
                {canSendReminders && (
                  <>
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
                  </>
                )}
                {canSendReminders && onShareLink && <DropdownMenuSeparator />}
                {onShareLink && (
                  <DropdownMenuItem onClick={() => onShareLink()}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share link…
                  </DropdownMenuItem>
                )}
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

function ViewerList({
  members,
  emptyText,
}: {
  members: AddressableMember[];
  emptyText: string;
}) {
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-border/50">
      {members.map((m) => {
        const initial = m.display_name?.charAt(0)?.toUpperCase() || "?";
        const role = m.roles?.[0];
        return (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={m.avatar_url || undefined} />
              <AvatarFallback className="text-xs bg-muted">{initial}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {m.display_name || "Unknown"}
              </span>
              {role && (
                <Badge variant="outline" className="capitalize text-[10px] h-5 px-1.5">
                  {role}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
