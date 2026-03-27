import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Calendar, MapPin, CheckCircle2, HelpCircle, X, Loader2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
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

function formatDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return { label: "Today", time: format(date, "h:mm a") };
  if (isTomorrow(date)) return { label: "Tomorrow", time: format(date, "h:mm a") };
  return { label: format(date, "EEE, MMM d"), time: format(date, "h:mm a") };
}

const typeBorderColors: Record<string, string> = {
  game: "border-destructive/60",
  training: "border-primary/60",
  social: "border-warning/60",
};

const typeGlowColors: Record<string, string> = {
  game: "shadow-destructive/10",
  training: "shadow-primary/10",
  social: "shadow-warning/10",
};

const typeLeftBorder: Record<string, string> = {
  game: "border-l-destructive",
  training: "border-l-primary",
  social: "border-l-warning",
};

function HeroCard({ event, fullWidth }: { event: EventItem; fullWidth?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { label: dateLabel, time: dateTime } = formatDate(event.event_date);

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
    },
    onError: () => {
      toast({ title: "Failed to update RSVP", variant: "destructive" });
    },
  });

  const rsvpButtons: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string }[] = [
    { status: "going", label: "Going", icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />, activeClass: "bg-primary text-primary-foreground hover:bg-primary/90" },
    { status: "maybe", label: "Maybe", icon: <HelpCircle className="h-4 w-4" aria-hidden="true" />, activeClass: "bg-warning text-warning-foreground hover:bg-warning/90" },
    { status: "not_going", label: "Can't go", icon: <X className="h-4 w-4" aria-hidden="true" />, activeClass: "bg-destructive text-destructive-foreground hover:bg-destructive/90" },
  ];

  return (
    <Card
      className={`border-2 ${typeBorderColors[event.type] || "border-primary/60"} shadow-lg ${typeGlowColors[event.type] || "shadow-primary/10"} cursor-pointer transition-all hover:shadow-xl ${fullWidth ? "w-full" : "min-w-[300px] w-[calc(100vw-2.5rem)] max-w-[420px]"} shrink-0 ${event.is_cancelled ? "opacity-60" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${event.title}${event.opponent ? ` vs ${event.opponent}` : ''}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-3.5 space-y-2.5">
        <div className="space-y-0.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`text-base font-bold leading-tight ${event.is_cancelled ? "line-through" : ""}`}>
              {event.title}
              {event.opponent ? ` vs ${event.opponent}` : ""}
            </h3>
            {event.is_cancelled && (
              <Badge variant="destructive" className="shrink-0 text-[10px]">Cancelled</Badge>
            )}
          </div>
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {event.teams?.name || event.clubs?.name}
          </Badge>
        </div>

        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden="true" />
            <span className="font-medium text-foreground">{dateLabel}</span>
            <span>at {dateTime}</span>
          </div>
          {(event.location_name || event.suburb) && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden="true" />
              <span className="truncate">{event.location_name || event.suburb}</span>
            </div>
          )}
        </div>

        {!event.is_cancelled && (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {rsvpButtons.map(({ status, label, icon, activeClass }) => {
              const isActive = currentStatus === status;
              return (
                <Button
                  key={status}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  aria-pressed={isActive}
                  aria-label={`RSVP ${label}`}
                  className={`flex-1 gap-1 text-[11px] font-medium h-8 ${isActive ? activeClass : ""}`}
                  disabled={rsvpMutation.isPending}
                  onClick={() => rsvpMutation.mutate(status)}
                >
                  {rsvpMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : icon}
                  {label}
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompactCard({ event }: { event: EventItem }) {
  const navigate = useNavigate();
  const { label: dateLabel, time: dateTime } = formatDate(event.event_date);
  const borderClass = typeLeftBorder[event.type] || "border-l-primary";

  return (
    <Card
      className={`border-l-[3px] ${borderClass} cursor-pointer hover:border-primary/50 transition-colors min-w-[220px] w-[65vw] max-w-[280px] shrink-0 ${event.is_cancelled ? "opacity-60" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${event.title}${event.opponent ? ` vs ${event.opponent}` : ''}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <CardContent className="p-3 pl-3.5 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`font-semibold text-[14px] leading-snug truncate ${event.is_cancelled ? "line-through" : ""}`}>
            {event.title}{event.opponent ? ` vs ${event.opponent}` : ""}
          </h3>
          {event.is_cancelled && (
            <Badge variant="destructive" className="text-[10px] h-4 shrink-0">Cancelled</Badge>
          )}
        </div>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal text-muted-foreground">
          {event.teams?.name || event.clubs?.name}
        </Badge>
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="font-medium text-foreground">{dateLabel}</span>
          <span>at {dateTime}</span>
        </div>
        {(event.location_name || event.suburb) && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{event.location_name || event.suburb}</span>
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
