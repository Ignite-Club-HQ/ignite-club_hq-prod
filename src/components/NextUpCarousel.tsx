import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MapPin, Check, HelpCircle, X, Loader2, Clock, ChevronRight, Users, CalendarClock, Baby, ChevronDown } from "lucide-react";
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
import { formatEventContextualDate, getEventUrgencyBadge } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { TeamChip } from "@/components/events/TeamChip";
import { getEventTypeIcon } from "@/lib/eventTypeIcon";
import { abbreviateLocation } from "@/lib/abbreviateLocation";
import { buildPersonalRsvpLine } from "@/lib/personalRsvpLine";

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
  opponent: string | null;
  arrival_minutes_before?: number | null;
  teams: { name: string; default_match_arrival_minutes?: number | null } | null;
  clubs: { name: string; sport: string | null };
}

interface NextUpCarouselProps {
  events: EventItem[];
  isLoading?: boolean;
}

// Reserve enough vertical space to fit the card with the Children's RSVP
// accordion in its collapsed state. This stops the home page from jolting
// downward when the per-event queries (myRsvp, childrenOnEvent) resolve a
// moment after the initial paint and the accordion appears.
const NEXT_UP_CARD_MIN_HEIGHT = "min-h-[260px]";

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
  if (parentHasRsvpd && currentStatus === "going") parts.push(<span key="you" className="text-primary font-medium">You: Going</span>);
  else if (parentHasRsvpd && currentStatus === "maybe") parts.push(<span key="you" className="text-warning font-medium">You: Maybe</span>);
  else if (parentHasRsvpd && currentStatus === "not_going") parts.push(<span key="you" className="text-destructive font-medium">You: Can't go</span>);

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

function HeroCard({ event, fullWidth }: { event: EventItem; fullWidth?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const locationDisplay = abbreviateLocation(event.location_name || event.suburb || event.address?.split(',')[0]);
  const urgency = getUrgencyBadge(event.event_date);
  const displayTitle = formatEventTitle(event);

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
  const { data: childrenOnEvent, isFetched: childrenFetched } = useChildrenForEvent(event, user?.id);
  const { data: childRsvps } = useChildRsvps(event.id, user?.id);
  const { data: rsvpSummary } = useRsvpSummary(event.id, event.type);

  // Hold the card's interactive sections until per-event queries settle so the
  // card doesn't grow (Children's RSVP accordion appears, helper text disappears)
  // a moment after first paint and visibly push the rest of the home page down.
  const heroDataReady = !user || (myRsvpFetched && childrenFetched);

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
    },
    onError: () => {
      toast({ title: "Failed to update child RSVP", variant: "destructive" });
    },
  });

  const rsvpOptions: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string; inactiveHint: string }[] = [
    { status: "going", label: "Going", icon: <Check className="h-3.5 w-3.5" />, activeClass: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90", inactiveHint: "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent" },
    { status: "maybe", label: "Maybe", icon: <HelpCircle className="h-3.5 w-3.5" />, activeClass: "bg-warning/15 text-warning border-warning/40", inactiveHint: "border-border/60 text-muted-foreground hover:bg-muted/50" },
    { status: "not_going", label: "Can't go", icon: <X className="h-3.5 w-3.5" />, activeClass: "bg-destructive/15 text-destructive border-destructive/40", inactiveHint: "border-border/60 text-muted-foreground hover:bg-muted/50" },
  ];

  return (
    <Card
      className={`shadow-md hover:shadow-lg transition-all cursor-pointer border-border/50 w-full shrink-0 h-full flex flex-col ${NEXT_UP_CARD_MIN_HEIGHT} ${event.is_cancelled ? "opacity-60" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-3 space-y-2 flex-1 flex flex-col">
        {/* Row 0: Urgency / contextual chip + arrow */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {urgency ? (
              <Badge variant="outline" className={`text-[10px] h-5 px-2 font-semibold border ${urgency.className}`}>
                {urgency.text}
              </Badge>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {dateLabel}
              </span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </div>

        {/* Primary: Team (large, prominent) · Secondary: Session title (muted) */}
        <div className="space-y-1">
          <TeamChip teamName={event.teams?.name} fallbackLabel={event.team_id ? "" : "Club event"} size="lg" />
          {(() => {
            const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
            return (
              <h3 className={`text-[13px] font-normal leading-snug text-muted-foreground flex items-center gap-1.5 ${event.is_cancelled ? "line-through" : ""}`}>
                <TypeIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                <span className="min-w-0 truncate">{displayTitle}</span>
              </h3>
            );
          })()}
          {event.is_cancelled && (
            <Badge variant="destructive" className="mt-1 text-[10px]">Cancelled</Badge>
          )}
        </div>

        {/* Time (strong) + Location (subtle) — never repeat the urgency label */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-[13px]">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="font-medium text-foreground">{dateTime}</span>
            {!urgency && (
              <span className="text-muted-foreground">· {dateLabel}</span>
            )}
          </div>
          {locationDisplay && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground/80">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
          {event.type === "game" && (() => {
            const mins = getMatchArrivalMinutes(event);
            const arrivalTime = formatMatchArrivalTime(event);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-2 text-[12px] text-warning">
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="font-medium">Arrive by {arrivalTime}</span>
                <span className="text-muted-foreground">({mins} min before)</span>
              </div>
            );
          })()}
        </div>

        {/* RSVP Buttons */}
        <div className="mt-auto" />
        {!event.is_cancelled && (
          <div className="space-y-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
                    className={`flex-1 gap-1.5 text-[12px] font-medium h-8 rounded-full transition-all ${
                      isActive
                        ? activeClass
                        : status === "going" && !currentStatus
                          ? inactiveHint
                          : inactiveHint
                    }`}
                    disabled={rsvpMutation.isPending || isActive}
                    onClick={() => !isActive && rsvpMutation.mutate(status)}
                  >
                    {rsvpMutation.isPending ? (
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

            {heroDataReady && childrenOnEvent && childrenOnEvent.length > 0 && (
              <details className="rounded-xl border border-border/50 bg-muted/20 group">
                <summary className="flex items-center gap-1.5 text-[11px] font-medium text-foreground cursor-pointer list-none p-2.5 [&::-webkit-details-marker]:hidden">
                  <Baby className="h-3.5 w-3.5 text-primary" />
                  <span>Children's RSVP</span>
                  {childRsvps && childRsvps.length > 0 ? (
                    <span className="text-[10px] text-muted-foreground ml-auto mr-1">
                      {childRsvps.filter(r => r.status === "going").length > 0 && `${childRsvps.filter(r => r.status === "going").length} going`}
                      {childRsvps.filter(r => r.status === "maybe").length > 0 && ` · ${childRsvps.filter(r => r.status === "maybe").length} maybe`}
                    </span>
                  ) : null}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
                </summary>
                <div className="space-y-2 px-2.5 pb-2.5">
                  {childrenOnEvent.map((child) => {
                    const childRsvp = childRsvps?.find((rsvp) => rsvp.child_id === child.id);

                    return (
                      <div key={child.id} className="space-y-1.5">
                        <div className="text-[11px] font-medium text-foreground">{child.name}</div>
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
                                className={`h-8 gap-1 px-2 text-[11px] font-medium rounded-full transition-all ${
                                  isActive ? activeClass : inactiveHint
                                }`}
                                disabled={childRsvpMutation.isPending || isActive}
                                onClick={() => !isActive && childRsvpMutation.mutate({ childId: child.id, status })}
                              >
                                {childRsvpMutation.isPending ? (
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
                </div>
              </details>
            )}

            {/* Personal-first RSVP summary — "Teddy going + N others" */}
            {(() => {
              if (!heroDataReady) {
                return <p className="text-[11px] text-muted-foreground/60 text-center invisible">placeholder</p>;
              }
              const goingChildNames = (childRsvps || [])
                .filter((r) => r.status === "going")
                .map((r) => r.children?.name?.split(" ")[0] || "Child");
              const summary = buildPersonalRsvpLine({
                parentStatus: currentStatus,
                goingChildNames,
                totalGoing: rsvpSummary?.totalCount || 0,
              });
              if (!summary) {
                return (
                  <p className="text-[11px] text-muted-foreground/60 text-center">
                    Be the first to RSVP
                  </p>
                );
              }
              const personal = goingChildNames.length > 0 || currentStatus === "going";
              return (
                <p className={`text-[11px] text-center ${personal ? "text-foreground/90 font-medium" : "text-muted-foreground"}`}>
                  {summary}
                </p>
              );
            })()}

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
  const subtitle = event.teams?.name || (!event.team_id ? "Club event" : null);
  const locationDisplay = abbreviateLocation(event.location_name || event.suburb || event.address?.split(',')[0]);
  const urgency = getUrgencyBadge(event.event_date);
  const displayTitle = formatEventTitle(event);

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
      className="cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md shadow-sm transition-all min-w-[220px] w-[65vw] max-w-[280px] shrink-0"
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-3.5 space-y-2.5">
        {/* Urgency/context row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {urgency ? (
              <Badge variant="outline" className={`text-[9px] h-[18px] px-1.5 font-semibold border ${urgency.className}`}>
                {urgency.text}
              </Badge>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {dateLabel}
              </span>
            )}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>

        {/* Primary: Team · Secondary: Session title */}
        <div className="space-y-1 min-w-0">
          <TeamChip teamName={event.teams?.name} fallbackLabel={event.team_id ? "" : "Club event"} size="md" />
          {(() => {
            const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
            return (
              <h3 className={`text-[12px] font-normal leading-snug text-muted-foreground flex items-center gap-1 min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <TypeIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
                <span className="truncate">{displayTitle}</span>
              </h3>
            );
          })()}
        </div>

        {/* Metadata: time strong, no urgency repeat */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="font-medium text-foreground">{dateTime}</span>
            {!urgency && (
              <span className="text-muted-foreground">· {dateLabel}</span>
            )}
          </div>
          {locationDisplay && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/80">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
          {event.type === "game" && (() => {
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
        {!event.is_cancelled && rsvpIndicator}
      </CardContent>
    </Card>
  );
}

export function NextUpCarousel({ events, isLoading }: NextUpCarouselProps) {
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Next Up</h2>
        <Link to="/events" className="text-xs text-muted-foreground/60 hover:text-primary transition-colors">
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
                    <HeroCard event={event} fullWidth />
                  ) : (
                    <HeroCard event={event} fullWidth />
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
        <HeroCard event={allEvents[0]} fullWidth />
      )}
    </section>
  );
}
