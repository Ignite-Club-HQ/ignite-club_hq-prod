import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { Clock, MapPin, MoreVertical, Pencil, Bell, XCircle, Trash2, Eye } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface EventCardEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social";
  event_date: string;
  address: string | null;
  suburb: string | null;
  location_name: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null };
}

interface EventCardProps {
  event: EventCardEvent;
  isAdmin: boolean;
  hasViewed?: boolean;
}

const typeBadgeStyles: Record<string, string> = {
  game: "bg-destructive/15 text-destructive border-destructive/20",
  training: "bg-primary/15 text-primary border-primary/20",
  social: "bg-warning/15 text-warning border-warning/20",
};

export function EventCard({ event, isAdmin, hasViewed = true }: EventCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [nonRsvpCount, setNonRsvpCount] = useState<number | null>(null);

  const isRecurring = event.is_recurring || event.parent_event_id;
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: event.mini_league_id });
  const locationDisplay = event.location_name || event.suburb || event.address?.split(",")[0];

  // Subtitle: team name for team events, "Club event" for club-wide
  const subtitle = event.teams?.name || (event.team_id ? null : "Club event");

  const { data: hasPro } = useQuery({
    queryKey: ["event-pro-status", event.team_id, event.club_id],
    queryFn: async () => {
      if (event.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) return true;
      }
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", event.club_id)
        .maybeSingle();
      return clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;
    },
  });

  const canSendReminders = hasPro === true;

  const deleteEventMutation = useMutation({
    mutationFn: async (deleteType: "single" | "series") => {
      if (deleteType === "series" && event.parent_event_id) {
        await supabase.from("events").delete().eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").delete().eq("id", event.parent_event_id);
      } else if (deleteType === "series" && event.is_recurring) {
        await supabase.from("events").delete().eq("parent_event_id", event.id);
        await supabase.from("events").delete().eq("id", event.id);
      } else {
        const { error } = await supabase.from("events").delete().eq("id", event.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      toast({ title: "Failed to delete event", variant: "destructive" });
    },
  });

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: "single" | "series"; customMessage?: string; sendPushNotification?: boolean }) => {
      if (cancelType === "series" && event.parent_event_id) {
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", event.parent_event_id);
      } else if (cancelType === "series" && event.is_recurring) {
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", event.id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", event.id);
      } else {
        const { error } = await supabase.from("events").update({ is_cancelled: true }).eq("id", event.id);
        if (error) throw error;
      }

      // Get members and post cancellation message
      let uniqueMembers: string[] = [];
      if (event.mini_league_id) {
        const { data: league } = await supabase.from("mini_leagues").select("club_id").eq("id", event.mini_league_id).single();
        if (league) {
          const { data: playersData } = await supabase.from("mini_league_players").select("parent_user_id").eq("mini_league_id", event.mini_league_id).not("parent_user_id", "is", null);
          const parentIds = (playersData?.map((p) => p.parent_user_id).filter(Boolean) as string[]) || [];
          const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("club_id", league.club_id).in("role", ["club_admin", "league_admin", "coach"]);
          const adminIds = adminRoles?.map((r) => r.user_id) || [];
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = [...new Set(members?.map((m) => m.user_id) || [])];
      }

      if (user) {
        const eventUrl = `${window.location.origin}/events/${event.id}`;
        const cancellationMessage = customMessage
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventUrl}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventUrl}`;

        if (event.mini_league_id) {
          const { data: chatGroup } = await supabase.from("chat_groups").select("id").eq("mini_league_id", event.mini_league_id).maybeSingle();
          if (chatGroup) {
            await supabase.from("group_messages").insert({ group_id: chatGroup.id, author_id: user.id, text: cancellationMessage });
          }
        } else if (event.team_id) {
          await supabase.from("team_messages").insert({ team_id: event.team_id, author_id: user.id, text: cancellationMessage });
        } else {
          await supabase.from("club_messages").insert({ club_id: event.club_id, author_id: user.id, text: cancellationMessage });
        }
      }

      return uniqueMembers.length;
    },
    onSuccess: () => {
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      toast({ title: "Failed to cancel event", variant: "destructive" });
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      const { data: rsvps } = await supabase.from("rsvps").select("user_id").eq("event_id", event.id);
      const rsvpUserIds = rsvps?.map((r) => r.user_id) || [];
      let memberQuery = supabase.from("user_roles").select("user_id");
      if (event.team_id) {
        memberQuery = memberQuery.eq("team_id", event.team_id);
      } else {
        memberQuery = memberQuery.eq("club_id", event.club_id);
      }
      const { data: members } = await memberQuery;
      const allMemberIds = [...new Set(members?.map((m) => m.user_id) || [])];
      const nonRsvpMembers = allMemberIds.filter((id) => !rsvpUserIds.includes(id));
      if (nonRsvpMembers.length === 0) throw new Error("Everyone has already RSVPed!");
      const { data: existingNotifications } = await supabase.from("notifications").select("user_id").eq("type", "event_reminder").eq("related_id", event.id).in("user_id", nonRsvpMembers);
      const existingNotificationUserIds = existingNotifications?.map((n) => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter((id) => !existingNotificationUserIds.includes(id));
      if (membersToNotify.length === 0) throw new Error("All members have already been reminded!");
      const notifications = membersToNotify.map((userId) => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event.title}"`,
        related_id: event.id,
      }));
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      return membersToNotify.length;
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  const handleRemindClick = async () => {
    const { data: rsvps } = await supabase.from("rsvps").select("user_id").eq("event_id", event.id);
    const rsvpUserIds = rsvps?.map((r) => r.user_id) || [];
    let memberQuery = supabase.from("user_roles").select("user_id");
    if (event.team_id) {
      memberQuery = memberQuery.eq("team_id", event.team_id);
    } else {
      memberQuery = memberQuery.eq("club_id", event.club_id);
    }
    const { data: members } = await memberQuery;
    const allMemberIds = [...new Set(members?.map((m) => m.user_id) || [])];
    const count = allMemberIds.filter((id) => !rsvpUserIds.includes(id)).length;
    setNonRsvpCount(count);
    setRemindDialogOpen(true);
  };

  return (
    <Card
      className={`group transition-all cursor-pointer border-border/60 hover:border-primary/40 hover:shadow-md ${event.is_cancelled ? "opacity-50" : ""}`}
      onClick={() => navigate(`/events/${event.id}`)}
    >
      <CardContent className="p-4 space-y-3">
        {/* Row 1: Title + Type badge + Admin menu */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className={`font-semibold text-[15px] leading-snug ${event.is_cancelled ? "line-through text-muted-foreground" : ""}`}>
              {event.title}
              {event.opponent && <span className="font-normal text-muted-foreground"> vs {event.opponent}</span>}
            </h3>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasPro && isAdmin && !hasViewed && !event.is_cancelled && (
              <Badge variant="default" className="gap-1 bg-primary text-primary-foreground text-[10px] h-5">
                <Eye className="h-3 w-3" />
                New
              </Badge>
            )}
            {event.is_cancelled ? (
              <Badge variant="destructive" className="text-[10px] h-5">Cancelled</Badge>
            ) : (
              <Badge variant="outline" className={`text-[10px] h-5 px-2 font-medium border ${typeBadgeStyles[event.type] || "bg-muted/50 text-muted-foreground"}`}>
                {typeLabel}
              </Badge>
            )}
            {isAdmin && (
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {!event.is_cancelled && (
                      <>
                        <DropdownMenuItem onClick={() => navigate(`/events/${event.id}/edit`)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {canSendReminders && (
                          <DropdownMenuItem onClick={handleRemindClick}>
                            <Bell className="h-3.5 w-3.5 mr-2" />
                            Send Reminders
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setCancelDialogOpen(true)} className="text-warning focus:text-warning">
                          <XCircle className="h-3.5 w-3.5 mr-2" />
                          Cancel Event
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Metadata */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <span>{format(parseISO(event.event_date), "EEE d MMM")} · {format(parseISO(event.event_date), "h:mm a")}</span>
          </div>
          {locationDisplay && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
        </div>

        {/* Row 3: Admin overflow menu */}
        {isAdmin && (
          <div className="flex items-center justify-end -mb-1" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5">
                  <MoreVertical className="h-3.5 w-3.5" />
                  Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {!event.is_cancelled && (
                  <>
                    <DropdownMenuItem onClick={() => navigate(`/events/${event.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    {canSendReminders && (
                      <DropdownMenuItem onClick={handleRemindClick}>
                        <Bell className="h-3.5 w-3.5 mr-2" />
                        Send Reminders
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCancelDialogOpen(true)} className="text-warning focus:text-warning">
                      <XCircle className="h-3.5 w-3.5 mr-2" />
                      Cancel Event
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </CardContent>

      {/* Dialogs */}
      <div onClick={(e) => e.stopPropagation()}>
        {isRecurring ? (
          <RecurringCancelEventDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onSingleAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })}
            onSeriesAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "series", customMessage, sendPushNotification })}
            isPending={cancelEventMutation.isPending}
          />
        ) : (
          <CancelEventConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventId={event.id}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onConfirm={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })}
            isPending={cancelEventMutation.isPending}
          />
        )}

        {isRecurring ? (
          <RecurringEventActionDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title={`Delete ${typeLabel}?`}
            description={`This will permanently delete the ${typeLabel.toLowerCase()}(s). This action cannot be undone.`}
            actionLabel="Delete"
            actionVariant="destructive"
            onSingleAction={() => deleteEventMutation.mutate("single")}
            onSeriesAction={() => deleteEventMutation.mutate("series")}
            isPending={deleteEventMutation.isPending}
          />
        ) : (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {typeLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this {typeLabel.toLowerCase()}. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteEventMutation.mutate("single")} className="bg-destructive text-destructive-foreground">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <AlertDialog open={remindDialogOpen} onOpenChange={setRemindDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send Reminders?</AlertDialogTitle>
              <AlertDialogDescription>
                {nonRsvpCount === 0
                  ? "Everyone has already RSVPed to this event!"
                  : `This will send a reminder notification to ${nonRsvpCount} member${nonRsvpCount === 1 ? "" : "s"} who haven't RSVPed yet.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {nonRsvpCount !== 0 && (
                <AlertDialogAction onClick={() => remindMutation.mutate()} disabled={remindMutation.isPending}>
                  Send Reminders
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
