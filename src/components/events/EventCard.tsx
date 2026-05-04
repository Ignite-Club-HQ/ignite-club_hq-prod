import { useState, useRef, useCallback } from "react";
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
import { Clock, MapPin, Pencil, Bell, XCircle, Trash2, Eye, CheckCircle2, HelpCircle, X, ChevronRight, Users, MoreVertical } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatEventContextualDate } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { TeamChip } from "@/components/events/TeamChip";

type RsvpStatus = "going" | "maybe" | "not_going";

export interface EventCardEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social";
  event_date: string;
  start_time?: string | null;
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
  arrival_minutes_before?: number | null;
  teams: { name: string; default_match_arrival_minutes?: number | null } | null;
  clubs: { name: string; sport: string | null };
}

interface EventCardProps {
  event: EventCardEvent;
  isAdmin: boolean;
  hasViewed?: boolean;
}

function formatContextualDate(dateStr: string) {
  const { label, time } = formatEventContextualDate(dateStr);
  return `${label} · ${time}`;
}

function buildFamilyRsvpSummary(
  parentStatus: RsvpStatus | null,
  parentName: string | undefined,
  childRsvps: Array<{ id: string; status: string; child_id: string; children: { name: string } | null }> | undefined
) {
  // Build a family line like "You + Archie, Teddy" or "Archie going, Teddy maybe"
  const goingNames: string[] = [];
  const maybeNames: string[] = [];
  const notGoingNames: string[] = [];

  if (parentStatus === "going") goingNames.push("You");
  else if (parentStatus === "maybe") maybeNames.push("You");
  else if (parentStatus === "not_going") notGoingNames.push("You");

  childRsvps?.forEach((rsvp) => {
    const name = rsvp.children?.name?.split(" ")[0] || "Child";
    if (rsvp.status === "going") goingNames.push(name);
    else if (rsvp.status === "maybe") maybeNames.push(name);
    else if (rsvp.status === "not_going") notGoingNames.push(name);
  });

  return { goingNames, maybeNames, notGoingNames };
}

export function EventCard({ event, isAdmin, hasViewed = true }: EventCardProps) {
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
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
  const displayTitle = formatEventTitle(event);

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

  // Fetch user's own RSVP
  const { data: myRsvp } = useQuery({
    queryKey: ["card-rsvp", event.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status")
        .eq("event_id", event.id)
        .eq("user_id", user!.id)
        .is("child_id", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !event.is_cancelled,
  });

  // Fetch child RSVPs
  const { data: childRsvps } = useQuery({
    queryKey: ["card-child-rsvps", event.id, user?.id],
    queryFn: async () => {
      const [ownChildren, guardianLinks] = await Promise.all([
        supabase.from("children").select("id").eq("parent_id", user!.id),
        supabase.from("child_guardians").select("child_id").eq("guardian_id", user!.id),
      ]);
      const childIds = [
        ...(ownChildren.data || []).map(c => c.id),
        ...(guardianLinks.data || []).map(g => g.child_id),
      ];
      if (childIds.length === 0) return [];
      const uniqueChildIds = [...new Set(childIds)];
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status, child_id, children:child_id(name)")
        .eq("event_id", event.id)
        .in("child_id", uniqueChildIds);
      if (error) throw error;
      return (data || []) as Array<{ id: string; status: string; child_id: string; children: { name: string } | null }>;
    },
    enabled: !!user && !event.is_cancelled,
  });

  // Fetch total event attendance counts
  // Social events: count everyone (parents + children)
  // Games/Training: count only players (child RSVPs)
  const isSocialEvent = event.type === "social";
  const { data: attendanceCounts } = useQuery({
    queryKey: ["card-attendance-counts", event.id, event.type],
    queryFn: async () => {
      let query = supabase
        .from("rsvps")
        .select("status")
        .eq("event_id", event.id);
      
      if (!isSocialEvent) {
        // For games/training, only count child (player) RSVPs
        query = query.not("child_id", "is", null);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      const counts = { going: 0, maybe: 0, not_going: 0 };
      (data || []).forEach((r) => {
        if (r.status === "going") counts.going++;
        else if (r.status === "maybe") counts.maybe++;
        else if (r.status === "not_going") counts.not_going++;
      });
      return counts;
    },
    enabled: !event.is_cancelled,
  });

  const currentRsvpStatus = (myRsvp?.status as RsvpStatus) ?? null;
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

  // Long-press to reveal three-dots admin button
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const [showAdminDots, setShowAdminDots] = useState(false);

  const handlePointerDown = useCallback(() => {
    if (!isAdmin) return;
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowAdminDots(true);
    }, 500);
  }, [isAdmin]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleCardClick = useCallback(() => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return; // Suppress navigation after long-press
    }
    navigate(`/events/${event.id}`);
  }, [navigate, event.id]);

  return (
    <Card
      className={`group relative transition-all cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md shadow-sm ${event.is_cancelled ? "opacity-50" : ""} select-none`}
      onClick={handleCardClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => { if (isAdmin) { e.preventDefault(); setShowAdminDots(true); } }}
    >
      <CardContent className="p-4 pb-3 space-y-2.5">
        {/* Row 0: Contextual date + status chips */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {formatEventContextualDate(event.event_date).label}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasPro && isAdmin && !hasViewed && !event.is_cancelled && (
              <Badge variant="default" className="gap-1 bg-primary text-primary-foreground text-[10px] h-5">
                <Eye className="h-3 w-3" />
                New
              </Badge>
            )}
            {event.is_cancelled && (
              <Badge variant="destructive" className="text-[10px] h-5">Cancelled</Badge>
            )}
          </div>
        </div>

        {/* Primary: Team chip — biggest scanning anchor */}
        {/* Secondary: Event title — same line/group, lighter weight */}
        <div className="space-y-1">
          <TeamChip teamName={event.teams?.name} fallbackLabel={event.team_id ? "" : "Club event"} size="lg" />
          <h3 className={`font-medium text-[15px] leading-snug text-foreground/90 ${event.is_cancelled ? "line-through text-muted-foreground" : ""}`}>
            {displayTitle}
          </h3>
        </div>

        {/* Tertiary: Date/time + Location */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[13px]">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="text-foreground/80">{formatContextualDate(event.event_date)}</span>
          </div>
          {event.type === "game" && (() => {
            const mins = getMatchArrivalMinutes(event);
            const arrivalTime = formatMatchArrivalTime(event);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-2 text-[13px] text-warning">
                <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
                <span>Arrive by {arrivalTime} ({mins} min before)</span>
              </div>
            );
          })()}
          {locationDisplay && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
        </div>

        {/* Row 3: RSVP Section - Personal + Global */}
        {!event.is_cancelled && (() => {
          const { goingNames, maybeNames, notGoingNames } = buildFamilyRsvpSummary(
            currentRsvpStatus, undefined, childRsvps
          );
          const hasPersonalRsvp = goingNames.length > 0 || maybeNames.length > 0 || notGoingNames.length > 0;
          const totalGoing = attendanceCounts?.going || 0;
          const totalMaybe = attendanceCounts?.maybe || 0;

          if (!hasPersonalRsvp) {
            return (
              <div className="pt-2 border-t border-border/40 space-y-1.5">
                {/* Global attendance even without personal RSVP */}
                {totalGoing > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Users className="h-3 w-3 shrink-0" />
                    <span>{totalGoing} going{totalMaybe > 0 ? ` · ${totalMaybe} maybe` : ""}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground/70 font-medium">Tap to RSVP</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                </div>
              </div>
            );
          }

          // Check if the parent (You) has actually RSVP'd
          const parentHasRsvpd = currentRsvpStatus !== null;
          const hasChildRsvps = childRsvps && childRsvps.length > 0;

          // Build child status groups (exclude "You")
          const childGoing = goingNames.filter(n => n !== "You");
          const childMaybe = maybeNames.filter(n => n !== "You");
          const childNotGoing = notGoingNames.filter(n => n !== "You");

          // Build child display parts
          const childParts: string[] = [];
          if (childGoing.length > 0) {
            const names = childGoing.length <= 3 ? childGoing.join(", ") : `${childGoing.slice(0, 2).join(", ")} +${childGoing.length - 2}`;
            childParts.push(`${names} going`);
          }
          if (childMaybe.length > 0) {
            const names = childMaybe.length <= 3 ? childMaybe.join(", ") : `${childMaybe.slice(0, 2).join(", ")} +${childMaybe.length - 2}`;
            childParts.push(`${names} maybe`);
          }
          if (childNotGoing.length > 0) {
            const names = childNotGoing.length <= 3 ? childNotGoing.join(", ") : `${childNotGoing.slice(0, 2).join(", ")} +${childNotGoing.length - 2}`;
            childParts.push(`${names} not going`);
          }

          // Determine the icon and color based on the best status across the household
          const bestIcon = goingNames.length > 0
            ? <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
            : maybeNames.length > 0
            ? <HelpCircle className="h-3.5 w-3.5 text-warning shrink-0" />
            : <X className="h-3.5 w-3.5 text-destructive shrink-0" />;

          // Build the display text
          let statusText: React.ReactNode;
          if (parentHasRsvpd) {
            // Parent has responded - show "You: Going/Maybe/Not going"
            const primaryStatus = currentRsvpStatus === "going"
              ? "Going"
              : currentRsvpStatus === "maybe"
              ? "Maybe"
              : "Not going";
            const personalStatusColor = currentRsvpStatus === "going"
              ? "text-primary"
              : currentRsvpStatus === "maybe"
              ? "text-warning"
              : "text-destructive";
            statusText = (
              <span className={`text-[12px] font-semibold ${personalStatusColor} truncate`}>
                You: {primaryStatus}
                {childParts.length > 0 && (
                  <span className="font-normal text-foreground/70">
                    {" · "}{childParts.join(" · ")}
                  </span>
                )}
              </span>
            );
          } else {
            // Parent hasn't responded - only show child statuses
            const childStatusColor = childGoing.length > 0
              ? "text-primary"
              : childMaybe.length > 0
              ? "text-warning"
              : "text-destructive";
            statusText = (
              <span className={`text-[12px] font-semibold ${childStatusColor} truncate`}>
                {childParts.join(" · ")}
              </span>
            );
          }

          return (
            <div className="pt-2 border-t border-border/40 space-y-1">
              {/* Line 1: Personal / household RSVP */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  {bestIcon}
                  {statusText}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </div>

              {/* Line 2: Global attendance */}
              {totalGoing > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Users className="h-3 w-3 shrink-0" />
                  <span>{totalGoing} going{totalMaybe > 0 ? ` · ${totalMaybe} maybe` : ""}</span>
                </div>
              )}
            </div>
          );
        })()}
      </CardContent>

      {/* Admin three-dots revealed by long-press */}
      {isAdmin && showAdminDots && (
        <div className="absolute top-12 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu open={adminMenuOpen} onOpenChange={(open) => {
            setAdminMenuOpen(open);
            if (!open) setShowAdminDots(false);
          }}>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-muted transition-colors">
                <MoreVertical className="h-4 w-4 text-foreground/70" />
              </button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
