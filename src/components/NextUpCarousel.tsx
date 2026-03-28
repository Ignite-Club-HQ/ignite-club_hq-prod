import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MapPin, Check, HelpCircle, X, Loader2, Clock, ChevronRight, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow, parseISO, differenceInCalendarDays, isThisWeek, isSameWeek, addWeeks } from "date-fns";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { Link } from "react-router-dom";

type RsvpStatus = "going" | "maybe" | "not_going";

interface EventItem {
  id: string;
  title: string;
  type: string;
  event_date: string;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  is_cancelled: boolean;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null };
}

interface NextUpCarouselProps {
  events: EventItem[];
}

function formatContextualDate(dateStr: string) {
  const date = parseISO(dateStr);
  const now = new Date();
  const time = format(date, "h:mm a");

  if (isToday(date)) return { label: "Today", time };
  if (isTomorrow(date)) return { label: "Tomorrow", time };

  const daysAway = differenceInCalendarDays(date, now);

  if (daysAway <= 6) {
    return { label: `This ${format(date, "EEEE")}`, time };
  }
  if (daysAway <= 13) {
    return { label: `Next ${format(date, "EEEE")}`, time };
  }
  return { label: format(date, "EEE, MMM d"), time };
}

const typeBadgeStyles: Record<string, string> = {
  game: "bg-destructive/10 text-destructive border-destructive/20",
  training: "bg-primary/10 text-primary border-primary/20",
  social: "bg-warning/10 text-warning border-warning/20",
};

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
  });
}

function useRsvpSummary(eventId: string) {
  return useQuery({
    queryKey: ["rsvp-summary", eventId],
    queryFn: async () => {
      const { data: rsvps, error } = await supabase
        .from("rsvps")
        .select("id, status, user_id")
        .eq("event_id", eventId)
        .eq("status", "going")
        .is("child_id", null)
        .limit(10);
      if (error) throw error;
      if (!rsvps || rsvps.length === 0) return [];

      const userIds = rsvps.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = (profiles || []).reduce((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {} as Record<string, { id: string; display_name: string | null; avatar_url: string | null }>);

      return rsvps.map(r => ({
        ...r,
        profile: profileMap[r.user_id] || null,
      }));
    },
  });
}

function ChildRsvpIndicators({ eventId, userId }: { eventId: string; userId: string | undefined }) {
  const { data: childRsvps } = useChildRsvps(eventId, userId);
  
  if (!childRsvps || childRsvps.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {childRsvps.map((rsvp) => (
        <Badge key={rsvp.id} variant="outline" className="text-[10px] h-5 px-1.5 gap-1 font-normal border-border/60">
          {rsvp.status === "going" && <Check className="h-2.5 w-2.5 text-primary" />}
          {rsvp.status === "maybe" && <HelpCircle className="h-2.5 w-2.5 text-warning" />}
          {rsvp.status === "not_going" && <X className="h-2.5 w-2.5 text-destructive" />}
          <span className="truncate max-w-[60px]">{rsvp.children?.name?.split(' ')[0] || "Child"}</span>
        </Badge>
      ))}
    </div>
  );
}

function AttendeeAvatars({ eventId }: { eventId: string }) {
  const { data: goingRsvps } = useRsvpSummary(eventId);

  if (!goingRsvps || goingRsvps.length === 0) return null;

  const visible = goingRsvps.slice(0, 3);
  const count = goingRsvps.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {visible.map((rsvp) => (
          <Avatar key={rsvp.id} className="h-6 w-6 border-2 border-background">
            <AvatarImage src={rsvp.profiles?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-[9px] font-medium">
              {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {count} going
      </span>
    </div>
  );
}

function HeroCard({ event, fullWidth }: { event: EventItem; fullWidth?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const typeLabel = event.type === "game" ? "Game" : event.type === "training" ? "Training" : event.type === "social" ? "Social" : "Event";
  const subtitle = event.teams?.name || (!event.team_id ? "Club event" : null);
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0];

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
  });

  const currentStatus = myRsvp?.status as RsvpStatus | null;

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
      if (status === "going" && rsvpId) {
        await awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs.name,
        });
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

  const rsvpOptions: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string }[] = [
    { status: "going", label: "Going", icon: <Check className="h-3.5 w-3.5" />, activeClass: "bg-primary text-primary-foreground shadow-sm" },
    { status: "maybe", label: "Maybe", icon: <HelpCircle className="h-3.5 w-3.5" />, activeClass: "bg-warning text-warning-foreground shadow-sm" },
    { status: "not_going", label: "Can't go", icon: <X className="h-3.5 w-3.5" />, activeClass: "bg-destructive text-destructive-foreground shadow-sm" },
  ];

  return (
    <Card
      className={`shadow-md hover:shadow-lg transition-all cursor-pointer border-border/50 ${fullWidth ? "w-full" : "min-w-[300px] w-[calc(100vw-2.5rem)] max-w-[420px]"} shrink-0 ${event.is_cancelled ? "opacity-60" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${event.title}${event.opponent ? ` vs ${event.opponent}` : ''}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-4 space-y-3">
        {/* Type badge + chevron */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] h-5 px-2 font-semibold border ${typeBadgeStyles[event.type] || "bg-muted/50 text-muted-foreground"}`}>
              {typeLabel}
            </Badge>
            {subtitle && (
              <span className="text-[11px] text-muted-foreground">{subtitle}</span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </div>

        {/* Title */}
        <div>
          <h3 className={`text-lg font-bold leading-tight tracking-tight ${event.is_cancelled ? "line-through text-muted-foreground" : ""}`}>
            {event.title}
            {event.opponent && <span className="font-semibold text-muted-foreground"> vs {event.opponent}</span>}
          </h3>
          {event.is_cancelled && (
            <Badge variant="destructive" className="mt-1 text-[10px]">Cancelled</Badge>
          )}
        </div>

        {/* Date + Location */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[13px]">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="font-medium text-foreground">{dateLabel}</span>
            <span className="text-muted-foreground">• {dateTime}</span>
          </div>
          {locationDisplay && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
        </div>

        {/* RSVP Buttons */}
        {!event.is_cancelled && (
          <div className="space-y-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex gap-2">
              {rsvpOptions.map(({ status, label, icon, activeClass }) => {
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
                          ? "border-primary/40 text-primary hover:bg-primary/5"
                          : "border-border/60 text-muted-foreground hover:bg-muted/50"
                    }`}
                    disabled={rsvpMutation.isPending}
                    onClick={() => rsvpMutation.mutate(status)}
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

            {/* Children RSVP + Attendees */}
            <div className="flex items-center justify-between">
              <ChildRsvpIndicators eventId={event.id} userId={user?.id} />
              <AttendeeAvatars eventId={event.id} />
            </div>
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
  const typeLabel = event.type === "game" ? "Game" : event.type === "training" ? "Training" : event.type === "social" ? "Social" : "Event";
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0];

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
  });

  const currentStatus = myRsvp?.status as RsvpStatus | null;

  const rsvpIndicator = currentStatus ? (
    <div className="flex items-center gap-1 text-[11px]">
      {currentStatus === "going" && <><Check className="h-3 w-3 text-primary" /><span className="text-primary font-medium">Going</span></>}
      {currentStatus === "maybe" && <><HelpCircle className="h-3 w-3 text-warning" /><span className="text-warning font-medium">Maybe</span></>}
      {currentStatus === "not_going" && <><X className="h-3 w-3 text-destructive" /><span className="text-destructive font-medium">Can't go</span></>}
    </div>
  ) : null;

  return (
    <Card
      className="cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md shadow-sm transition-all min-w-[220px] w-[65vw] max-w-[280px] shrink-0"
      role="button"
      tabIndex={0}
      aria-label={`${event.title}${event.opponent ? ` vs ${event.opponent}` : ''}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-3.5 space-y-2.5">
        {/* Type badge row */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 font-semibold border ${typeBadgeStyles[event.type] || ""}`}>
            {typeLabel}
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>

        {/* Title */}
        <div>
          <h3 className={`font-bold text-[14px] leading-snug truncate ${event.is_cancelled ? "line-through text-muted-foreground" : ""}`}>
            {event.title}{event.opponent ? ` vs ${event.opponent}` : ""}
          </h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="font-medium text-foreground">{dateLabel}</span>
            <span className="text-muted-foreground">• {dateTime}</span>
          </div>
          {locationDisplay && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="truncate">{locationDisplay}</span>
            </div>
          )}
        </div>

        {/* RSVP Status */}
        {!event.is_cancelled && (rsvpIndicator || true) && (
          <div className="space-y-1.5">
            {rsvpIndicator}
            <ChildRsvpIndicators eventId={event.id} userId={user?.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function NextUpCarousel({ events }: NextUpCarouselProps) {
  if (!events || events.length === 0) return null;

  const heroEvent = events[0];
  const secondaryEvents = events.slice(1, 6);
  const hasSecondary = secondaryEvents.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Next Up</h2>
        <Link to="/events" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </div>
      {hasSecondary ? (
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-3">
            <HeroCard event={heroEvent} />
            {secondaryEvents.map((event) => (
              <CompactCard key={event.id} event={event} />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      ) : (
        <HeroCard event={heroEvent} fullWidth />
      )}
    </section>
  );
}
