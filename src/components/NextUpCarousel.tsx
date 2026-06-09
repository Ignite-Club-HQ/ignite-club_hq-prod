import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MapPin, Check, HelpCircle, X, Loader2, Clock, ChevronRight, Users, CalendarClock, Baby, ChevronDown, User, AlertCircle, Play, Eye, CheckCircle2 } from "lucide-react";
import { useCanStartGame } from "@/hooks/useCanStartGame";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { formatEventContextualDate, getEventUrgencyBadge, formatCompactDateTime } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { getEventDisplay } from "@/lib/eventDisplay";
import { TeamChip, getTeamRailColor } from "@/components/events/TeamChip";
import { getEventTypeIcon, getEventTypeAccent, getEventTypeAccentClasses } from "@/lib/eventTypeIcon";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";

import { useEventMembership } from "@/hooks/useEventMembership";
import { isParentFirstEvent } from "@/lib/rsvpAudience";

type RsvpStatus = "going" | "maybe" | "not_going";

interface EventItem {
  id: string;
  title: string;
  type: string;
  event_date: string;
  start_time?: string | null;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  is_cancelled: boolean;
  is_bye?: boolean;
  opponent: string | null;
  arrival_minutes_before?: number | null;
  teams: { name: string; default_match_arrival_minutes?: number | null } | null;
  clubs: { name: string; sport: string | null };
}

interface NextUpCarouselProps {
  events: EventItem[];
  isLoading?: boolean;
}

function StartGameCta({ event }: { event: EventItem }) {
  const navigate = useNavigate();
  const { canStart, phase } = useCanStartGame(event);
  if (!canStart) return null;
  const label = phase === "live" ? "Open Match" : "Start Game";
  return (
    <div className="pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        className="w-full h-10 gap-2 font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => navigate(`/events/${event.id}?openPitchBoard=1`)}
      >
        <Play className="h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}

/**
 * Shown to non-controllers (no team_admin/coach role and not Subs Manager)
 * when there is an active live game on the event's team. Opens the read-only
 * spectator view. Hidden for controllers — they already have Start/Open Match.
 */
function WatchLiveCta({ event }: { event: EventItem }) {
  const navigate = useNavigate();
  const { canStart } = useCanStartGame(event);

  // Only show within the live match window: 30 min before kickoff → 3 h after.
  // Prevents stale `active_games` rows from making "Watch Live" appear days
  // before a fixture.
  const inLiveWindow = (() => {
    const kickoffIso = event.start_time || event.event_date;
    if (!kickoffIso) return false;
    const kickoff = new Date(kickoffIso).getTime();
    if (Number.isNaN(kickoff)) return false;
    const now = Date.now();
    return now >= kickoff - 30 * 60 * 1000 && now <= kickoff + 3 * 60 * 60 * 1000;
  })();

  const eligible =
    event.type === "game" &&
    !event.is_cancelled &&
    !event.is_bye &&
    !!event.team_id &&
    !canStart &&
    inLiveWindow;

  const { data: hasLive } = useQuery({
    queryKey: ["watch-live-active", event.team_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("active_games")
        .select("id")
        .eq("team_id", event.team_id!)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      return !!data;
    },
    enabled: eligible,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  if (!eligible || !hasLive) return null;

  return (
    <div className="pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-10 gap-2 font-semibold border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={() => navigate(`/teams/${event.team_id}/watch-live`)}
      >
        <Eye className="h-4 w-4" />
        Watch Live
      </Button>
    </div>
  );
}

// Reserve enough vertical space to fit the card with the Children's RSVP
// accordion in its collapsed state. This stops the home page from jolting
// downward when the per-event queries (myRsvp, childrenOnEvent) resolve a
// moment after the initial paint and the accordion appears.
// Reserve enough vertical space to fit the fully expanded card layout
// (incl. the Children's RSVP accordion bar and personal RSVP summary line)
// so the home page never grows / pushes other content downward as the
// per-event queries (myRsvp, childrenOnEvent, rsvpSummary) resolve a
// moment after first paint.
// Soft minimum height — reserves the loaded collapsed layout without leaving
// a large empty tail under normal RSVP controls.
const NEXT_UP_CARD_MIN_HEIGHT = "min-h-[420px]";

function formatContextualDate(dateStr: string) {
  return formatEventContextualDate(dateStr);
}

function getUrgencyBadge(dateStr: string) {
  return getEventUrgencyBadge(dateStr);
}

function useChildRsvps(eventId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ["child-rsvps-card", eventId, userId],
    queryFn: async () => {
      const [ownChildren, guardianLinks] = await Promise.all([
        supabase.from("children").select("id").eq("parent_id", userId!),
        supabase.from("child_guardians").select("child_id").eq("guardian_id", userId!),
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
        .eq("event_id", eventId)
        .in("child_id", uniqueChildIds);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        status: string;
        child_id: string;
        children: { name: string } | null;
      }>;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

function useChildrenForEvent(event: Pick<EventItem, "id" | "team_id" | "club_id">, userId: string | undefined) {
  return useQuery({
    queryKey: ["event-children-card", event.id, event.team_id, event.club_id, userId],
    queryFn: async () => {
      const [ownChildren, guardianLinks] = await Promise.all([
        event.team_id
          ? supabase
              .from("children")
              .select("id, name, child_team_assignments!inner (team_id)")
              .eq("parent_id", userId!)
              .eq("child_team_assignments.team_id", event.team_id)
          : supabase
              .from("children")
              .select("id, name")
              .eq("parent_id", userId!),
        supabase
          .from("child_guardians")
          .select("child_id, children!inner (id, name)")
          .eq("guardian_id", userId!),
      ]);

      const directChildren = ownChildren.data || [];
      const guardianChildren = (guardianLinks.data || [])
        .map((guardianLink: any) => guardianLink.children)
        .filter(Boolean);

      let filteredGuardianChildren = guardianChildren;

      if (event.team_id && guardianChildren.length > 0) {
        const guardianChildIds = guardianChildren.map((child: any) => child.id);
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .eq("team_id", event.team_id)
          .in("child_id", guardianChildIds);

        const assignedIds = new Set((assignments || []).map((assignment: any) => assignment.child_id));
        filteredGuardianChildren = guardianChildren.filter((child: any) => assignedIds.has(child.id));
      }

      const seen = new Set<string>();

      return [...directChildren, ...filteredGuardianChildren].filter((child: any) => {
        if (seen.has(child.id)) return false;
        seen.add(child.id);
        return true;
      }) as Array<{ id: string; name: string }>;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

function useRsvpSummary(eventId: string, eventType?: string) {
  const isSocial = eventType === "social";
  return useQuery({
    queryKey: ["rsvp-summary", eventId, eventType],
    queryFn: async () => {
      // First get the total count
      let countQuery = supabase
        .from("rsvps")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "going");
      
      if (!isSocial) {
        countQuery = countQuery.not("child_id", "is", null);
      }
      
      const { count } = await countQuery;

      // Then get a few for avatars
      let avatarQuery = supabase
        .from("rsvps")
        .select("id, status, user_id, child_id, mini_league_player_id, children:child_id(name), mini_league_players:mini_league_player_id(name)")
        .eq("event_id", eventId)
        .eq("status", "going");
      
      if (!isSocial) {
        avatarQuery = avatarQuery.not("child_id", "is", null);
      }
      
      const { data: rsvps, error } = await avatarQuery.limit(5);
      if (error) throw error;
      if (!rsvps || rsvps.length === 0) return { avatars: [], totalCount: 0 };

      const guardianUserIds = [
        ...new Set(
          rsvps
            .filter(r => !r.child_id && !r.mini_league_player_id && r.user_id)
            .map(r => r.user_id)
        ),
      ];

      const profileMap = guardianUserIds.length > 0
        ? Object.fromEntries(
            ((await supabase
              .from("profiles")
              .select("id, display_name, avatar_url")
              .in("id", guardianUserIds)).data || []).map((profile) => [profile.id, profile])
          )
        : {};

      return {
        avatars: rsvps.map(r => ({
          id: r.id,
          displayName:
            r.children?.name ||
            r.mini_league_players?.name ||
            profileMap[r.user_id]?.display_name ||
            "?",
          avatarUrl:
            r.child_id || r.mini_league_player_id
              ? null
              : profileMap[r.user_id]?.avatar_url || null,
        })),
        totalCount: count || rsvps.length,
      };
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

function HouseholdRsvpSummary({ eventId, userId, currentStatus }: { eventId: string; userId: string | undefined; currentStatus: RsvpStatus | null }) {
  const { data: childRsvps } = useChildRsvps(eventId, userId);
  
  if (!childRsvps || childRsvps.length === 0) {
    return null;
  }

  const goingChildren = childRsvps.filter(r => r.status === "going");
  const maybeChildren = childRsvps.filter(r => r.status === "maybe");
  const notGoingChildren = childRsvps.filter(r => r.status === "not_going");
  const parentHasRsvpd = currentStatus !== null;

  const parts: React.ReactNode[] = [];
  
  // User status
  if (parentHasRsvpd && currentStatus === "going") parts.push(<span key="you" className="text-muted-foreground font-medium">Going</span>);
  else if (parentHasRsvpd && currentStatus === "maybe") parts.push(<span key="you" className="text-muted-foreground font-medium">Maybe</span>);
  else if (parentHasRsvpd && currentStatus === "not_going") parts.push(<span key="you" className="text-muted-foreground font-medium">Can't go</span>);

  if (goingChildren.length > 0) {
    const names = goingChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="going" className="flex items-center gap-0.5">
        <Check className="h-2.5 w-2.5 text-primary" />
        <span>{names}</span>
      </span>
    );
  }
  if (maybeChildren.length > 0) {
    const names = maybeChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="maybe" className="flex items-center gap-0.5">
        <HelpCircle className="h-2.5 w-2.5 text-warning" />
        <span>{names} maybe</span>
      </span>
    );
  }
  if (notGoingChildren.length > 0) {
    const names = notGoingChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="notgoing" className="flex items-center gap-0.5">
        <X className="h-2.5 w-2.5 text-destructive" />
        <span>{names} not going</span>
      </span>
    );
  }

  if (parts.length === 0) return null;

  return (
    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-border mx-0.5">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function AttendeeAvatars({ eventId, eventType }: { eventId: string; eventType?: string }) {
  const { data: summary } = useRsvpSummary(eventId, eventType);

  if (!summary || summary.totalCount === 0) return null;

  const visible = summary.avatars.slice(0, 3);
  const remaining = summary.totalCount - visible.length;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">Attending</span>
      <div className="flex -space-x-1.5">
        {visible.map((rsvp) => (
          <Avatar key={rsvp.id} className="h-5 w-5 border-[1.5px] border-background">
              <AvatarImage src={rsvp.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-[8px] font-medium">
                {rsvp.displayName?.charAt(0)?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

function HeroCard({ event, fullWidth, onNeedsRsvpChange }: { event: EventItem; fullWidth?: boolean; onNeedsRsvpChange?: (eventId: string, needs: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const compactWhen = formatCompactDateTime(event.event_date);
  // Full location — venue + pitch/court is critical info; never abbreviate or truncate.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0] || "";
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: (event as any).mini_league_id });
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);

  // Team / type visual identity — same system as schedule cards.
  const teamRailHex = getTeamRailColor(event.teams?.name) || `hsl(var(--primary))`;
  const typeAccent = getEventTypeAccent(event.type, {
    miniLeagueId: (event as any).mini_league_id,
    opponent: event.opponent,
  });
  const typeAccentClasses = getEventTypeAccentClasses(typeAccent);
  const isToday = (() => {
    try {
      const today = new Date();
      const evt = new Date(event.event_date);
      return today.toDateString() === evt.toDateString();
    } catch { return false; }
  })();

  const { data: myRsvp, isFetched: myRsvpFetched } = useQuery({
    queryKey: ["hero-rsvp", event.id, user?.id],
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
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const currentStatus = (myRsvp?.status as RsvpStatus) ?? null;
  const [parentRsvpOpen, setParentRsvpOpen] = useState(false);
  const { data: childrenOnEvent, isFetched: childrenFetched } = useChildrenForEvent(event, user?.id);
  const { data: childRsvps, isFetched: childRsvpsFetched } = useChildRsvps(event.id, user?.id);
  const { data: rsvpSummary } = useRsvpSummary(event.id, event.type);

  // Hold the card's interactive sections until per-event queries settle so the
  // card doesn't grow (Children's RSVP accordion appears, helper text disappears)
  // a moment after first paint and visibly push the rest of the home page down.
  // Also gates the "RSVP Required" pill so it never flashes before child
  // RSVPs hydrate (which would briefly show the pill on already-responded events).
  const heroDataReady = !user || (myRsvpFetched && childrenFetched && childRsvpsFetched);

  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;
      if (myRsvp) {
        const { error } = await supabase.from("rsvps").update({ status }).eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase
          .from("rsvps")
          .insert({ event_id: event.id, user_id: user!.id, status })
          .select("id")
          .single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }
      // Fire-and-forget: don't block UI for points calculation
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs.name,
        }).catch(console.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", event.id] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", event.id] });
      queryClient.invalidateQueries({ queryKey: ["next-up-pending-count"] });
    },
    onError: () => {
      toast({ title: "Failed to update RSVP", variant: "destructive" });
    },
  });

  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status }: { childId: string; status: RsvpStatus }) => {
      const existingChildRsvp = childRsvps?.find((rsvp) => rsvp.child_id === childId);
      let rsvpId: string | null = null;

      if (existingChildRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingChildRsvp.id);

        if (error) throw error;
        rsvpId = existingChildRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase
          .from("rsvps")
          .insert({
            event_id: event.id,
            child_id: childId,
            user_id: user!.id,
            status,
          })
          .select("id")
          .single();

        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Fire-and-forget: award early RSVP points for child
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", event.id] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", event.id] });
      queryClient.invalidateQueries({ queryKey: ["next-up-pending-count"] });
    },
    onError: () => {
      toast({ title: "Failed to update child RSVP", variant: "destructive" });
    },
  });

  // RSVP buttons: selected state must read as locked-in and confirmed at a glance.
  const rsvpOptions: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string; inactiveHint: string }[] = [
    {
      status: "going",
      label: "Going",
      icon: <Check className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
    {
      status: "maybe",
      label: "Maybe",
      icon: <HelpCircle className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
    {
      status: "not_going",
      label: "Can't go",
      icon: <X className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
  ];

  const isMatchDay = !!(event as any).mini_league_id;

  // Guardian context: parent has one or more children rostered on this event's team.
  const hasGuardianChildren = !!(heroDataReady && childrenOnEvent && childrenOnEvent.length > 0);
  const guardianUnrespondedChildren = hasGuardianChildren
    ? childrenOnEvent!.filter((c) => !childRsvps?.find((r) => r.child_id === c.id))
    : [];
  const guardianUnrespondedCount = guardianUnrespondedChildren.length;

  // "Needs RSVP" — in guardian mode this means any child still needs a response;
  // otherwise it falls back to the parent's own un-actioned state.
  const { data: isEventMember = true } = useEventMembership({ team_id: event.team_id, club_id: event.club_id });
  const needsRsvp =
    heroDataReady &&
    !event.is_cancelled &&
    !event.is_bye &&
    isEventMember &&
    (hasGuardianChildren
      ? guardianUnrespondedCount > 0
      : currentStatus === null && (childRsvps?.length ?? 0) === 0);

  // Report up to parent so the carousel "X need RSVP" badge stays in sync
  // with what each card actually shows (membership, BYE, guardian children).
  React.useEffect(() => {
    onNeedsRsvpChange?.(event.id, !!needsRsvp);
    return () => onNeedsRsvpChange?.(event.id, false);
  }, [needsRsvp, event.id, onNeedsRsvpChange]);

  const needsRsvpPillLabel = hasGuardianChildren
    ? (guardianUnrespondedCount === 1
        ? `${(guardianUnrespondedChildren[0].name.split(" ")[0] || guardianUnrespondedChildren[0].name)} needs RSVP`
        : `${guardianUnrespondedCount} players need RSVP`)
    : "RSVP Required";

  return (
    <Card
      className={`relative overflow-hidden shadow-md hover:shadow-lg transition-all cursor-pointer w-full shrink-0 h-full flex flex-col ${event.is_cancelled ? "opacity-60 border-border/50" : needsRsvp ? "border-primary/40 bg-primary/[0.04]" : "border-border/50"}`}
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      {/* Team color rail — primary recognition cue, identical system to the schedule cards */}
      <span
        className="absolute left-0 top-0 bottom-0 w-0.5 pointer-events-none"
        style={{ backgroundColor: teamRailHex, opacity: isToday ? 0.35 : 0.22 }}
        aria-hidden="true"
      />
      {/* Right-edge tap affordance — hidden when RSVP pill is shown to avoid
          competing with the high-emphasis action marker. */}
      {!needsRsvp && (
        <ChevronRight
          className="absolute right-2.5 top-3.5 h-4 w-4 text-muted-foreground/35 pointer-events-none z-10"
          aria-hidden="true"
        />
      )}
      <CardContent className="p-3.5 pl-4 pr-9 space-y-2 flex-1 flex flex-col">
        {/* Status row: Today badge + needs-RSVP pill + BYE + cancelled marker */}
        {(isToday || event.is_cancelled || event.is_bye || needsRsvp) && (
          <div className="flex items-center justify-end gap-1.5 -mr-3">
            {needsRsvp && !event.is_cancelled && !event.is_bye && (
              <span
                role="status"
                aria-label="RSVP required"
                className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-wide bg-amber-500 text-white shadow-sm shadow-amber-500/30 animate-fade-in"
              >
                <AlertCircle className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
                {needsRsvpPillLabel}
              </span>
            )}
            {event.is_bye && !event.is_cancelled && (
              <Badge variant="secondary" className="text-[9.5px] h-[18px] px-1.5 font-bold tracking-wider">
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
        )}

        {/* HIERARCHY: Team identity first (title-weight), then event context, then logistics */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;

          if (isSocial) {
            return (
              <div className="space-y-1 min-w-0">
                <h3 className={`text-[17px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1.5 text-[12px]">
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

          const isGame =
            event.type === "game" ||
            event.type === "mini_league" ||
            !!(event as any).mini_league_id ||
            !!event.opponent;

          return (
            <div className="space-y-1.5">
              {isMatchDay && (
                <span className={`text-[10px] font-bold uppercase tracking-wider ${typeAccentClasses.text}`}>
                  Match Day
                </span>
              )}
              {/* PRIMARY: team identity as title */}
              <TeamChip
                teamName={event.teams?.name}
                fallbackLabel={event.team_id ? "" : "Club event"}
                size="lg"
                asTitle
              />
              {/* SECONDARY: event context */}
              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-medium leading-snug">
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`min-w-0 truncate ${typeAccent === "default" ? "text-foreground/85" : typeAccentClasses.text}`}>
                    {isGame
                      ? (event.is_bye ? "BYE — no match" : (event.opponent ? `vs ${event.opponent}` : eventDisplay.primary))
                      : eventDisplay.primary}
                  </span>
                </div>
                {!isGame && eventDisplay.secondary && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground/80 leading-snug truncate pl-5">
                    {eventDisplay.secondary}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* TERTIARY (still highly visible): time + location.
            Location gets its OWN line so long pitch/court names stay fully visible —
            this is the question parents/coaches open the app to answer. */}
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
          {event.type === "game" && !event.is_bye && (() => {
            const mins = getMatchArrivalMinutes(event);
            const arrivalTime = formatMatchArrivalTime(event);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-1.5 text-[12px] text-warning">
                <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
                <span className="font-medium">Arrive by {arrivalTime}</span>
                <span className="text-muted-foreground">({mins} min before)</span>
              </div>
            );
          })()}
        </div>


        {/* RSVP Buttons — outline, status-tinted when selected. Lower visual weight than
            previous solid-primary "Going" so the team identity reads first, but tap targets
            stay generous (h-9 = 36px, full row width). */}
        <div className="mt-auto" />
        <StartGameCta event={event} />
        <WatchLiveCta event={event} />
        {!event.is_cancelled && !event.is_bye && (
          <div className="space-y-2 pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {(hasGuardianChildren && !isParentFirstEvent(event)) ? (() => {
              const teammatesGoing = rsvpSummary?.totalCount || 0;
              const isSingleChild = childrenOnEvent!.length === 1;
              const soleChild = isSingleChild ? childrenOnEvent![0] : null;
              const soleChildFirst = soleChild ? (soleChild.name.split(" ")[0] || soleChild.name) : "";
              const soleChildRsvp = soleChild ? childRsvps?.find((r) => r.child_id === soleChild.id) : undefined;

              const applyAllPending = childRsvpMutation.isPending;
              const applyAllToChildren = (status: RsvpStatus) => {
                childrenOnEvent!.forEach((child) => {
                  const existing = childRsvps?.find((r) => r.child_id === child.id);
                  if (existing?.status === status) return;
                  childRsvpMutation.mutate({ childId: child.id, status });
                });
              };

              const childStatusLines = childrenOnEvent!.map((child) => {
                const r = childRsvps?.find((rsvp) => rsvp.child_id === child.id);
                const first = child.name.split(" ")[0] || child.name;
                if (r?.status === "going") return `${first} is going`;
                if (r?.status === "maybe") return `${first} might go`;
                if (r?.status === "not_going") return `${first} can't go`;
                return null;
              }).filter(Boolean) as string[];

              return (
                <>
                  {/* Primary prompt — child/player focused */}
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                    <Baby className="h-3.5 w-3.5 text-primary shrink-0" />
                    {isSingleChild ? (
                      soleChildRsvp
                        ? <span>RSVP for {soleChildFirst}</span>
                        : <span>Can {soleChildFirst} attend?</span>
                    ) : (
                      guardianUnrespondedCount > 0
                        ? <span>{guardianUnrespondedCount === childrenOnEvent!.length
                            ? `${childrenOnEvent!.length} players need RSVP`
                            : `${guardianUnrespondedCount} of ${childrenOnEvent!.length} players need RSVP`}</span>
                        : <span>RSVP for your players</span>
                    )}
                  </div>

                  {isSingleChild ? (
                    /* Single child — buttons act as the primary RSVP */
                    <div className="flex gap-2">
                      {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                        const isActive = soleChildRsvp?.status === status;
                        const pendingVars = childRsvpMutation.variables;
                        const isThisPending =
                          childRsvpMutation.isPending &&
                          pendingVars?.childId === soleChild!.id &&
                          pendingVars?.status === status;
                        return (
                          <Button
                            key={status}
                            variant="outline"
                            size="sm"
                            aria-pressed={isActive}
                            aria-label={`${soleChildFirst} RSVP ${label}`}
                            className={`flex-1 gap-1.5 text-[12px] h-9 rounded-full transition-all duration-200 ease-out will-change-transform ${
                              isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                            }`}
                            disabled={childRsvpMutation.isPending}
                            onClick={() => !isActive && childRsvpMutation.mutate({ childId: soleChild!.id, status })}
                          >
                            {isThisPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : isActive ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              icon
                            )}
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    /* Multiple children — compact rows, one per child */
                    <div className="space-y-1.5">
                      {childrenOnEvent!.map((child) => {
                        const childRsvp = childRsvps?.find((r) => r.child_id === child.id);
                        const first = child.name.split(" ")[0] || child.name;
                        const isUnresponded = !childRsvp;
                        return (
                          <div key={child.id} className="space-y-1">
                            <div className="flex items-center gap-1.5 text-[11.5px]">
                              <span className={`font-semibold ${isUnresponded ? "text-foreground" : "text-foreground/85"}`}>{first}</span>
                              {isUnresponded && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                                  <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                                  </span>
                                  needs RSVP
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                                const isActive = childRsvp?.status === status;
                                const pendingVars = childRsvpMutation.variables;
                                const isThisPending =
                                  childRsvpMutation.isPending &&
                                  pendingVars?.childId === child.id &&
                                  pendingVars?.status === status;
                                return (
                                  <Button
                                    key={`${child.id}-${status}`}
                                    variant="outline"
                                    size="sm"
                                    aria-pressed={isActive}
                                    aria-label={`${child.name} RSVP ${label}`}
                                    className={`h-8 gap-1 px-2 text-[11px] rounded-full transition-all duration-200 ease-out will-change-transform ${
                                      isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                                    }`}
                                    disabled={childRsvpMutation.isPending}
                                    onClick={() => !isActive && childRsvpMutation.mutate({ childId: child.id, status })}
                                  >
                                    {isThisPending ? (
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : isActive ? (
                                      <Check className="h-3 w-3" />
                                    ) : (
                                      icon
                                    )}
                                    <span className="truncate">{label}</span>
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Apply-same shortcut — only when multiple children */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="text-[10px] text-muted-foreground">Apply to all:</span>
                        {rsvpOptions.map(({ status, label, icon }) => (
                          <button
                            key={`all-${status}`}
                            type="button"
                            disabled={applyAllPending}
                            onClick={() => applyAllToChildren(status)}
                            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-muted/40 transition-colors disabled:opacity-50"
                            aria-label={`Apply ${label} to all children`}
                          >
                            {icon}
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary line — child-first, then teammate count */}
                  <div className="rounded-xl border border-border/25 bg-muted/[0.06] px-2.5 py-1.5 space-y-0.5 opacity-75">
                    {childStatusLines.length > 0 ? (
                      childStatusLines.map((line, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground font-medium">
                          <User className="h-3 w-3 shrink-0 opacity-60" />
                          <span className="truncate">{line}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
                        <User className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate">
                          {isSingleChild ? `${soleChildFirst} hasn't been RSVP'd yet` : "Players awaiting RSVP"}
                        </span>
                      </div>
                    )}
                    {teammatesGoing > 0 && (
                      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
                        <Users className="h-3 w-3 shrink-0 opacity-60" />
                        <span>{teammatesGoing} {teammatesGoing === 1 ? "teammate" : "teammates"} going</span>
                      </div>
                    )}
                  </div>

                  {/* Optional parent RSVP — secondary disclosure */}
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setParentRsvpOpen((v) => !v)}
                      aria-expanded={parentRsvpOpen}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                    >
                      <span>
                        {currentStatus ? "Your attendance" : "Are you attending too?"}
                      </span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${parentRsvpOpen ? "rotate-180" : ""}`} />
                    </button>
                    {parentRsvpOpen && (
                      <div className="flex gap-1.5 pt-1.5">
                        {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                          const isActive = currentStatus === status;
                          return (
                            <Button
                              key={`parent-${status}`}
                              variant="outline"
                              size="sm"
                              aria-pressed={isActive}
                              aria-label={`Your RSVP ${label}`}
                              className={`flex-1 h-8 gap-1 px-2 text-[11px] rounded-full transition-all duration-200 ease-out will-change-transform ${
                                isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                              }`}
                              disabled={rsvpMutation.isPending}
                              onClick={() => !isActive && rsvpMutation.mutate(status)}
                            >
                              {rsvpMutation.isPending && rsvpMutation.variables === status ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : isActive ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                icon
                              )}
                              <span className="truncate">{label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })() : (
              <>
                {/* No guardian children on this event — parent RSVP remains primary */}
                <div className="flex gap-2">
                  {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                    const isActive = currentStatus === status;
                    return (
                      <Button
                        key={status}
                        variant="outline"
                        size="sm"
                        aria-pressed={isActive}
                        aria-label={`RSVP ${label}`}
                        className={`flex-1 gap-1.5 text-[12px] h-9 rounded-full transition-all duration-200 ease-out will-change-transform ${
                          isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                        }`}
                        disabled={rsvpMutation.isPending}
                        onClick={() => !isActive && rsvpMutation.mutate(status)}
                      >
                        {rsvpMutation.isPending && rsvpMutation.variables === status ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : isActive ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          icon
                        )}
                        {label}
                      </Button>
                    );
                  })}
                </div>

                {(() => {
                  if (!heroDataReady) {
                    return <p className="text-[11px] text-muted-foreground/60 text-center invisible">placeholder</p>;
                  }
                  const teammatesGoing = rsvpSummary?.totalCount || 0;
                  if (currentStatus && teammatesGoing === 0) return null;
                  return (
                    <div className="rounded-xl border border-border/20 bg-muted/[0.04] px-2.5 py-1.5 space-y-0.5 opacity-70">
                      {teammatesGoing > 0 && (
                        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
                          <Users className="h-3 w-3 shrink-0 opacity-60" />
                          <span>{teammatesGoing} {teammatesGoing === 1 ? "teammate" : "teammates"} going</span>
                        </div>
                      )}
                      {!currentStatus && (
                        <p className="text-[10px] text-muted-foreground/70 italic">
                          Tap an option above to RSVP
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Secondary children RSVP — club-wide social events with household kids */}
                {isParentFirstEvent(event) && hasGuardianChildren && (
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setParentRsvpOpen((v) => !v)}
                      aria-expanded={parentRsvpOpen}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                    >
                      <Baby className="h-3 w-3" />
                      <span>RSVP your {childrenOnEvent!.length === 1 ? "child" : "children"} too?</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${parentRsvpOpen ? "rotate-180" : ""}`} />
                    </button>
                    {parentRsvpOpen && (
                      <div className="space-y-2 pt-2">
                        {childrenOnEvent!.map((child) => {
                          const childRsvp = childRsvps?.find((r) => r.child_id === child.id);
                          const first = child.name.split(" ")[0] || child.name;
                          return (
                            <div key={child.id} className="space-y-1">
                              <div className="text-[11px] font-medium text-foreground/85">{first}</div>
                              <div className="grid grid-cols-3 gap-1.5">
                                {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                                  const isActive = childRsvp?.status === status;
                                  return (
                                    <Button
                                      key={`${child.id}-${status}`}
                                      variant="outline"
                                      size="sm"
                                      aria-pressed={isActive}
                                      aria-label={`${child.name} RSVP ${label}`}
                                      className={`h-8 gap-1 px-2 text-[11px] rounded-full transition-all duration-200 ease-out will-change-transform ${
                                        isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                                      }`}
                                      disabled={childRsvpMutation.isPending}
                                      onClick={() => !isActive && childRsvpMutation.mutate({ childId: child.id, status })}
                                    >
                                      {isActive ? <Check className="h-3 w-3" /> : icon}
                                      <span className="truncate">{label}</span>
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompactCard({ event }: { event: EventItem }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const compactWhen = formatCompactDateTime(event.event_date);

  // Full location — keep pitch/court details visible.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0] || "";
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: (event as any).mini_league_id });
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);

  const { data: myRsvp } = useQuery({
    queryKey: ["hero-rsvp", event.id, user?.id],
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
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const currentStatus = (myRsvp?.status as RsvpStatus) ?? null;

  const rsvpIndicator = currentStatus ? (
    <div className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
      currentStatus === "going" ? "bg-primary/10" :
      currentStatus === "maybe" ? "bg-warning/10" :
      "bg-destructive/10"
    }`}>
      {currentStatus === "going" && <><Check className="h-3 w-3 text-primary" /><span className="text-primary font-medium">Going</span></>}
      {currentStatus === "maybe" && <><HelpCircle className="h-3 w-3 text-warning" /><span className="text-warning font-medium">Maybe</span></>}
      {currentStatus === "not_going" && <><X className="h-3 w-3 text-destructive" /><span className="text-destructive font-medium">Can't go</span></>}
    </div>
  ) : (
    <div className="text-[10px] text-muted-foreground/50 italic">Tap to RSVP</div>
  );

  return (
    <Card
      className="relative cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md shadow-sm transition-all min-w-[220px] w-[65vw] max-w-[280px] shrink-0"
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <ChevronRight
        className="absolute right-3 top-4 h-4 w-4 text-muted-foreground/35 pointer-events-none z-10"
        aria-hidden="true"
      />
      <CardContent className="p-3.5 pr-7 space-y-2">
        {/* Status: BYE / Cancelled */}
        {(event.is_cancelled || event.is_bye) && (
          <div className="flex items-center justify-end gap-1.5">
            {event.is_bye && !event.is_cancelled && (
              <Badge variant="secondary" className="text-[10px] h-5 font-bold tracking-wider">BYE</Badge>
            )}
            {event.is_cancelled && (
              <Badge variant="destructive" className="text-[10px] h-5">Cancelled</Badge>
            )}
          </div>
        )}

        {/* Social/club events lead with the event name; structured events lead with team. */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;

          if (isSocial) {
            return (
              <div className="space-y-0.5 min-w-0">
                <h3 className={`text-[14px] font-semibold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
                  <TypeIcon className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
                  <span className="truncate">{typeLabel}</span>
                  {hasTeam && (
                    <>
                      <span className="text-border">·</span>
                      <span className="truncate">{event.teams!.name}</span>
                    </>
                  )}
                </div>
              </div>
            );
          }

          const isTrainingType = event.type === "training";
          return (
            <div className="space-y-1 min-w-0">
              <TeamChip teamName={event.teams?.name} fallbackLabel={event.team_id ? "" : "Club event"} size="md" />
              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className={`flex items-center gap-1 text-[13px] min-w-0 ${isTrainingType ? "font-medium text-foreground/75" : "font-semibold text-foreground"}`}>
                  <TypeIcon className={`h-3 w-3 shrink-0 ${isTrainingType ? "opacity-55" : "opacity-80"}`} aria-hidden="true" />
                  <span className="truncate">{eventDisplay.primary}</span>
                </div>
                {eventDisplay.secondary && (
                  <p className={`mt-0.5 text-[11px] leading-snug truncate pl-4 ${isTrainingType ? "text-muted-foreground/65" : "text-muted-foreground"}`}>
                    {eventDisplay.secondary}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Compact date + time on one line */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock className="h-3 w-3 shrink-0 text-muted-foreground/45" aria-hidden="true" />
            <span className="font-normal text-foreground/80">{compactWhen}</span>
          </div>
          {locationDisplay && (
            <div className="flex items-start gap-1.5 text-[12.5px]">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/60 mt-0.5" aria-hidden="true" />
              <span className="font-semibold text-foreground leading-snug break-words">{locationDisplay}</span>
            </div>
          )}
          {event.type === "game" && !event.is_bye && (() => {
            const mins = getMatchArrivalMinutes(event);
            const arrivalTime = formatMatchArrivalTime(event);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-1.5 text-[12px] text-warning">
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="font-medium truncate">Arrive by {arrivalTime} ({mins}m before)</span>
              </div>
            );
          })()}
        </div>

        {/* RSVP Status */}
        {!event.is_cancelled && !event.is_bye && rsvpIndicator}
      </CardContent>
    </Card>
  );
}

export function NextUpCarousel({ events, isLoading }: NextUpCarouselProps) {
  const { user } = useAuth();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 1,
  });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);

  const onSelect = React.useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;
    setScrollSnaps(emblaApi.scrollSnapList());
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", () => {
      setScrollSnaps(emblaApi.scrollSnapList());
      onSelect();
    });
    onSelect();
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  // Aggregate "needs RSVP" count — driven by each card's own needsRsvp signal
  // so this badge can never disagree with what's actually shown on the cards
  // (membership, BYE, guardian-children, parent-first events all factor in).
  const carouselEventIds = React.useMemo(
    () => (events || []).slice(0, 6).filter(e => !e.is_cancelled && !e.is_bye).map(e => e.id),
    [events],
  );

  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());

  const handleNeedsRsvpChange = React.useCallback((eventId: string, needs: boolean) => {
    setPendingIds(prev => {
      const has = prev.has(eventId);
      if (needs && !has) {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      }
      if (!needs && has) {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      }
      return prev;
    });
  }, []);

  // Drop any stale ids no longer in the visible carousel.
  React.useEffect(() => {
    const allowed = new Set(carouselEventIds);
    setPendingIds(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => { if (allowed.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [carouselEventIds]);

  const pendingCount = pendingIds.size;

  // Show skeleton while loading to reserve space and prevent layout shift
  if (isLoading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-6 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
        </div>
        <div className={`rounded-lg bg-muted animate-pulse ${NEXT_UP_CARD_MIN_HEIGHT}`} />
      </section>
    );
  }

  if (!events || events.length === 0) return null;

  const allEvents = events.slice(0, 6);
  const showCarousel = allEvents.length > 1;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold">Next Up</h2>
          {pendingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] h-5 font-semibold bg-amber-500 text-white shadow-sm shadow-amber-500/30 animate-fade-in shrink-0"
              aria-label={`${pendingCount} ${pendingCount === 1 ? "event needs" : "events need"} your RSVP`}
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
              {pendingCount} {pendingCount === 1 ? "needs RSVP" : "need RSVP"}
            </span>
          )}
        </div>
        <Link to="/events" className="text-xs text-muted-foreground/60 hover:text-primary transition-colors shrink-0">
          View all →
        </Link>
      </div>

      {showCarousel ? (
        <div className="relative">
          {/* Carousel */}
          <div ref={emblaRef} className="overflow-hidden">
            <div className="flex">
              {allEvents.map((event, index) => (
                <div
                  key={event.id}
                  className="flex-[0_0_96%] min-w-0 pr-2 transition-transform duration-300 flex"
                  style={{
                    transform: selectedIndex === index ? "scale(1)" : "scale(0.95)",
                    opacity: selectedIndex === index ? 1 : 0.85,
                    transformOrigin: "center center",
                  }}
                >
                  {index === 0 ? (
                    <HeroCard event={event} fullWidth onNeedsRsvpChange={handleNeedsRsvpChange} />
                  ) : (
                    <HeroCard event={event} fullWidth onNeedsRsvpChange={handleNeedsRsvpChange} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right edge fade gradient */}
          <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10" />

          {/* Pagination dots */}
          {scrollSnaps.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-3">
              {scrollSnaps.map((_, index) => (
                <button
                  key={index}
                  className={`rounded-full transition-all duration-300 ${
                    index === selectedIndex
                      ? "w-5 h-1.5 bg-primary"
                      : "w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/40"
                  }`}
                  onClick={() => emblaApi?.scrollTo(index)}
                  aria-label={`Go to event ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <HeroCard event={allEvents[0]} fullWidth onNeedsRsvpChange={handleNeedsRsvpChange} />
      )}
    </section>
  );
}
