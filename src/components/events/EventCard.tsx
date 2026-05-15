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
import { Clock, MapPin, Pencil, Bell, XCircle, Trash2, Eye, CheckCircle2, HelpCircle, X, ChevronRight, Users, MoreVertical, AlertCircle } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { formatEventContextualDate, formatCompactDateTime } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { getEventDisplay } from "@/lib/eventDisplay";
import { TeamChip, getTeamRailColor } from "@/components/events/TeamChip";
import { getEventTypeIcon, getEventTypeAccent, getEventTypeAccentClasses } from "@/lib/eventTypeIcon";

import { buildPersonalRsvpLine } from "@/lib/personalRsvpLine";
import { useEventMembership } from "@/hooks/useEventMembership";

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
  is_bye?: boolean | null;
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
  /** Index in stacked list — used for subtle zebra tinting to break the wall-of-cards effect. */
  stackIndex?: number;
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

export function EventCard({ event, isAdmin, hasViewed = true, stackIndex = 0 }: EventCardProps) {
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
  // Location: full visibility — pitch/court details are operationally critical.
  // Do NOT abbreviate; let the dedicated row wrap if needed.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(",")[0] || "";
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);
  const compactWhen = formatCompactDateTime(event.event_date);

  // Team / type visual identity — drives the left color rail and accent tints.
  const teamRailColor = getTeamRailColor(event.teams?.name);
  const typeAccent = getEventTypeAccent(event.type, {
    miniLeagueId: event.mini_league_id,
    opponent: event.opponent,
  });
  const typeAccentClasses = getEventTypeAccentClasses(typeAccent);
  // "Today" boost — full-strength rail; otherwise dim slightly so today reads first.
  const isToday = (() => {
    try {
      const today = new Date();
      const evt = new Date(event.event_date);
      return today.toDateString() === evt.toDateString();
    } catch { return false; }
  })();
  const railOpacity = isToday ? 1 : 0.7;
  const railHex = teamRailColor || `hsl(var(--primary))`;
  // Zebra: barely-perceptible alternation for stacked lists
  const zebraBg = stackIndex % 2 === 1 ? "bg-card/60" : "bg-card";




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
  const { data: myRsvp, isLoading: myRsvpLoading } = useQuery({
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
  const { data: childRsvps, isLoading: childRsvpsLoading } = useQuery({
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
  const { data: isEventMember = true } = useEventMembership({ team_id: event.team_id, club_id: event.club_id });

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
    onError: (error) => {
      toast(friendlyMutationError(error, { title: "Failed to cancel event", description: "Please try again." }));
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
      className={`group relative overflow-hidden transition-all cursor-pointer border-border/50 hover:border-primary/40 hover:shadow-md shadow-sm ${zebraBg} ${event.is_cancelled ? "opacity-50" : ""} select-none`}
      onClick={handleCardClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => { if (isAdmin) { e.preventDefault(); setShowAdminDots(true); } }}
    >
      {/* Team color rail — primary recognition cue. Today = full strength, future = dimmed. */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1 pointer-events-none"
        style={{ backgroundColor: railHex, opacity: railOpacity }}
        aria-hidden="true"
      />
      {/* Right-edge tap affordance — optically aligned to the title row, not floating mid-card */}
      <ChevronRight
        className="absolute right-2.5 top-3.5 h-4 w-4 text-muted-foreground/35 pointer-events-none"
        aria-hidden="true"
      />
      <CardContent className="p-3.5 pb-3 pr-9 pl-4 space-y-1.5">
        {/* Status chips only — section header already conveys the date.
             Positioned with extra right padding so the chevron isn't crowded. */}
        {(() => {
          if (!event.is_cancelled && !isToday && !event.is_bye) return null;
          return (
            <div className="flex items-center justify-end gap-1.5 -mr-3">
              {event.is_bye && !event.is_cancelled && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] h-[18px] px-1.5 font-bold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40"
                >
                  BYE
                </Badge>
              )}
              {isToday && !event.is_cancelled && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] h-[18px] px-1.5 font-bold uppercase tracking-wide bg-primary/10 text-primary border-primary/30"
                >
                  Today
                </Badge>
              )}
              {event.is_cancelled && (
                <Badge variant="destructive" className="text-[9.5px] h-[18px] px-1.5">Cancelled</Badge>
              )}
            </div>
          );
        })()}

        {/* HIERARCHY:
            1. TEAM (title-weight, with color dot) — primary scanning anchor
            2. EVENT CONTEXT (type icon + opponent / training label) — secondary
            3. LOGISTICS (time + location) — kept high-contrast, full-size
            Social/club-wide events flip 1↔2 since the title carries the meaning. */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: event.mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;
          const isMatchDay = !!event.mini_league_id;

          if (isSocial) {
            return (
              <div className="space-y-1 min-w-0">
                <h3 className={`text-[15px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1.5 text-[12px] min-w-0">
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`font-medium ${typeAccentClasses.text}`}>{typeLabel}</span>
                  {hasTeam && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-muted-foreground truncate">{event.teams!.name}</span>
                    </>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-1.5">
              {/* Match Day eyebrow — only competitive events earn extra vertical space */}
              {isMatchDay && (
                <span className={`text-[10px] font-bold uppercase tracking-wider ${typeAccentClasses.text}`}>
                  Match Day
                </span>
              )}
              {/* PRIMARY: team identity as title */}
              <TeamChip
                teamName={event.teams?.name}
                fallbackLabel={event.team_id ? "" : "Club event"}
                size="md"
                asTitle
              />
              {/* SECONDARY: event context */}
              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className={`flex items-center gap-1.5 text-[13px] font-medium`}>
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`min-w-0 truncate ${typeAccent === "default" ? "text-foreground/80" : typeAccentClasses.text}`}>
                    {eventDisplay.primary}
                  </span>
                </div>
                {eventDisplay.secondary && (
                  <p className="mt-0.5 text-[12px] leading-snug truncate pl-5 text-muted-foreground">
                    {eventDisplay.secondary}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* TERTIARY (still highly visible): time + location.
            Location gets its OWN line so long pitch/court names are never
            truncated — that's operationally critical info for sport. */}
        <div className="space-y-0.5 pt-0.5">
          <div className="flex items-center gap-1.5 text-[13.5px] text-foreground font-semibold">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="min-w-0">{compactWhen}</span>
          </div>
          {locationDisplay && (
            <div className="flex items-start gap-1.5 text-[13px] text-foreground/90">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <span className="min-w-0 font-medium leading-snug break-words">{locationDisplay}</span>
            </div>
          )}
          {event.type === "game" && (() => {
            const mins = getMatchArrivalMinutes(event);
            const arrivalTime = formatMatchArrivalTime(event);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-1.5 text-[12px] text-warning">
                <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
                <span className="font-medium">Arrive by {arrivalTime} ({mins} min before)</span>
              </div>
            );
          })()}
        </div>

        {/* RSVP summary only — Schedule = browse, no action buttons */}
        {!event.is_cancelled && (() => {
          const rsvpDataPending = myRsvpLoading || childRsvpsLoading;
          if (rsvpDataPending) {
            // Reserve the row so the badge/summary doesn't pop in late.
            return <div className="pt-2 mt-1 border-t border-border/40 h-[26px]" aria-hidden="true" />;
          }

          const goingChildNames = (childRsvps || [])
            .filter((r) => r.status === "going")
            .map((r) => r.children?.name?.split(" ")[0] || "Child");

          // Mirrors NextUpCarousel: badge whenever neither the parent nor ANY
          // of their children on this event have an RSVP recorded yet
          // (regardless of how many other people are going).
          const householdHasAnyRsvp =
            currentRsvpStatus !== null || (childRsvps?.length ?? 0) > 0;

          if (!householdHasAnyRsvp && isEventMember) {
            return (
              <div className="flex items-center pt-2 mt-1 border-t border-border/40 min-w-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white px-2 py-0.5 text-[11px] font-semibold shadow-sm shadow-amber-500/30 animate-fade-in">
                  <AlertCircle className="h-3 w-3" />
                  RSVP Required
                </span>
              </div>
            );
          }

          const summary = buildPersonalRsvpLine({
            parentStatus: currentRsvpStatus,
            goingChildNames,
            totalGoing: attendanceCounts?.going || 0,
          });

          if (!summary) {
            // Household responded (e.g. "not going" / "maybe") but nobody is
            // going — keep the row reserved so layout stays stable.
            return <div className="pt-2 mt-1 border-t border-border/40 h-[26px]" aria-hidden="true" />;
          }

          const personal = goingChildNames.length > 0 || currentRsvpStatus === "going";

          return (
            <div className="flex items-center pt-2 mt-1 border-t border-border/40 gap-1.5 min-w-0">
              {personal ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className={`text-[12px] truncate ${personal ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {summary}
              </span>
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
