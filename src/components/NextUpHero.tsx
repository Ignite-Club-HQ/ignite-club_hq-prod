import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Clock, MapPin, CheckCircle2, HelpCircle, X, Loader2, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { shouldAppendOpponent } from "@/lib/eventTitle";
import { TeamChip } from "@/components/events/TeamChip";
import { getEventTypeIcon } from "@/lib/eventTypeIcon";

type RsvpStatus = "going" | "maybe" | "not_going";

interface NextUpHeroProps {
  event: {
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
  };
}

function formatHeroDate(dateStr: string) {
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

export function NextUpHero({ event }: NextUpHeroProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { label: dateLabel, time: dateTime } = formatHeroDate(event.event_date);

  // Fetch user's current RSVP for this event
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

  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;

      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", myRsvp.id);
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
    },
    onError: () => {
      toast({ title: "Failed to update RSVP", variant: "destructive" });
    },
  });

  const rsvpButtons: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string }[] = [
    {
      status: "going",
      label: "Going",
      icon: <CheckCircle2 className="h-4 w-4" />,
      activeClass: "bg-primary text-white border-primary shadow-md shadow-primary/40 dark:shadow-primary/50 ring-2 ring-primary/40 dark:ring-primary/60",
    },
    {
      status: "maybe",
      label: "Maybe",
      icon: <HelpCircle className="h-4 w-4" />,
      activeClass: "bg-warning text-white border-warning shadow-md shadow-warning/40 dark:shadow-warning/50 ring-2 ring-warning/40 dark:ring-warning/60",
    },
    {
      status: "not_going",
      label: "Can't go",
      icon: <X className="h-4 w-4" />,
      activeClass: "bg-destructive text-white border-destructive shadow-md shadow-destructive/40 dark:shadow-destructive/50 ring-2 ring-destructive/40 dark:ring-destructive/60",
    },
  ];
  const selectedLabel = rsvpButtons.find((b) => b.status === currentStatus)?.label;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Next Up</h2>
      <Card
        className={`border-2 ${typeBorderColors[event.type] || "border-primary/60"} shadow-lg ${typeGlowColors[event.type] || "shadow-primary/10"} cursor-pointer transition-all hover:shadow-xl ${event.is_cancelled ? "opacity-60" : ""}`}
        onClick={() => navigate(`/events/${event.id}`)}
      >
        <CardContent className="p-5 space-y-4">
          {/* Header: contextual date label */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {dateLabel}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {event.is_bye && !event.is_cancelled && (
                <Badge variant="secondary" className="font-bold tracking-wider">BYE</Badge>
              )}
              {event.is_cancelled && (
                <Badge variant="destructive">Cancelled</Badge>
              )}
            </div>
          </div>

          {/* Primary: Team chip — biggest scanning anchor */}
          {/* Secondary: Event title */}
          <div className="space-y-1.5">
            <TeamChip teamName={event.teams?.name} fallbackLabel={event.team_id ? "" : "Club event"} size="lg" />
            {(() => {
              const TypeIcon = getEventTypeIcon(event.type);
              return (
                <h3 className={`text-lg font-medium leading-snug text-foreground/90 flex items-center gap-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  <span className="min-w-0">
                    {event.is_bye ? `${event.title} — BYE` : (
                      <>
                        {event.title}
                        {shouldAppendOpponent(event) ? ` vs ${event.opponent}` : ""}
                      </>
                    )}
                  </span>
                </h3>
              );
            })()}
          </div>

          {/* Date + Location */}
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-foreground/70" />
              <span className="font-medium text-foreground">{dateTime}</span>
            </div>
            {!event.is_bye && (event.location_name || event.suburb || event.address) && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-foreground/70" />
                <span>{event.location_name || event.suburb || event.address?.split(',')[0]}</span>
              </div>
            )}
            {event.type === "game" && !event.is_bye && (() => {
              const mins = getMatchArrivalMinutes(event);
              const arrivalTime = formatMatchArrivalTime(event);
              if (mins == null || !arrivalTime) return null;
              return (
                <div className="flex items-center gap-2 text-warning">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span className="font-medium">Arrive by {arrivalTime}</span>
                  <span>({mins} min before)</span>
                </div>
              );
            })()}
            {event.is_bye && (
              <p className="text-sm text-muted-foreground italic">No match this round — enjoy the weekend off!</p>
            )}
          </div>

          {/* RSVP Buttons */}
          {!event.is_cancelled && !event.is_bye && (
            <div className="space-y-2 pt-1" onClick={(e) => e.stopPropagation()}>
              <div
                role="radiogroup"
                aria-label="RSVP response"
                className="inline-flex w-full gap-0 rounded-lg border border-border/60 bg-muted/40 p-1"
              >
                {rsvpButtons.map(({ status, label, icon, activeClass }) => {
                  const isActive = currentStatus === status;
                  const isLoading = rsvpMutation.isPending && rsvpMutation.variables === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={label}
                      disabled={rsvpMutation.isPending}
                      onClick={() => !isActive && rsvpMutation.mutate(status)}
                      className={[
                        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold",
                        "transition-all duration-200 ease-out touch-manipulation",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        "disabled:cursor-not-allowed",
                        isActive
                          ? `${activeClass} scale-[1.02] animate-scale-in`
                          : "bg-transparent text-muted-foreground/80 border border-transparent hover:text-foreground active:scale-[0.98]",
                      ].join(" ")}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={isActive ? "text-white" : "opacity-70"}>{icon}</span>
                      )}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-4 text-xs text-muted-foreground flex items-center gap-1.5" aria-live="polite">
                {selectedLabel && !rsvpMutation.isPending && (
                  <span className="inline-flex items-center gap-1 text-foreground/80 animate-fade-in">
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                    Selected: <span className="font-medium">{selectedLabel}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
