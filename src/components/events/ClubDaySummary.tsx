import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { MapPin, Clock, Trophy, Dumbbell, Users, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EventCard, type EventCardEvent } from "@/components/events/EventCard";

interface ClubDaySummaryProps {
  selectedDate: Date;
  clubIds: string[];
  /** Team IDs the user is a member of — used for "My teams" filter (default view). */
  myTeamIds?: string[];
  /** Initial scope. Defaults to "my". */
  defaultScope?: "my" | "club";
  /**
   * Full EventCard-shaped events for the selected day that the user has access to.
   * When provided, the "My teams" view renders rich EventCards instead of compact rows.
   */
  myDayEvents?: EventCardEvent[];
  /** Set of event IDs the current user has already viewed (for "New" badge on EventCard). */
  viewedEventIds?: Set<string>;
  /** Returns true if the current user is admin for a given event. */
  isAdminForEvent?: (event: EventCardEvent) => boolean;
}

interface ClubDayEvent {
  id: string;
  title: string;
  type: "game" | "training";
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  address: string | null;
  suburb: string | null;
  team_id: string | null;
  team_name: string | null;
  opponent: string | null;
  is_cancelled: boolean;
}

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

function venueLabel(e: ClubDayEvent): string {
  return (
    e.location_name ||
    [e.address, e.suburb].filter(Boolean).join(", ") ||
    "Location TBD"
  );
}

/**
 * Day summary for a single date. Defaults to showing only events for teams
 * the user belongs to ("My teams"); a toggle switches to a club-wide view
 * (all teams) where events are grouped by venue/location.
 */
export function ClubDaySummary({
  selectedDate,
  clubIds,
  myTeamIds = [],
  defaultScope = "my",
  myDayEvents,
  viewedEventIds,
  isAdminForEvent,
}: ClubDaySummaryProps) {
  const dKey = dayKey(selectedDate);
  const [scope, setScope] = useState<"my" | "club">(defaultScope);

  const { data: events, isLoading } = useQuery({
    queryKey: ["club-day-events", dKey, clubIds.slice().sort().join(",")],
    queryFn: async () => {
      if (!clubIds.length) return [] as ClubDayEvent[];
      const all: ClubDayEvent[] = [];
      for (const clubId of clubIds) {
        const { data, error } = await supabase.rpc("get_club_day_events", {
          _club_id: clubId,
          _day: dKey,
        });
        if (error) throw error;
        if (data) all.push(...(data as ClubDayEvent[]));
      }
      return all.sort((a, b) => {
        const at = a.start_time || a.event_date;
        const bt = b.start_time || b.event_date;
        return at.localeCompare(bt);
      });
    },
    enabled: clubIds.length > 0,
    staleTime: 60 * 1000,
  });

  const myTeamSet = useMemo(() => new Set(myTeamIds), [myTeamIds]);
  const visible = useMemo(() => {
    if (!events) return [] as ClubDayEvent[];
    if (scope === "club") return events;
    return events.filter((e) => e.team_id && myTeamSet.has(e.team_id));
  }, [events, scope, myTeamSet]);

  const games = visible.filter((e) => e.type === "game");
  const trainings = visible.filter((e) => e.type === "training");

  // Group by venue for club view
  const byVenue = useMemo(() => {
    const map = new Map<string, ClubDayEvent[]>();
    for (const e of visible) {
      const k = venueLabel(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">
          {format(selectedDate, "EEEE, MMMM d")}
        </h2>
        <ToggleGroup
          type="single"
          size="sm"
          value={scope}
          onValueChange={(v) => v && setScope(v as "my" | "club")}
          className="shrink-0"
        >
          <ToggleGroupItem value="my" className="h-7 px-2 text-xs gap-1">
            <Users className="h-3 w-3" />
            My teams
          </ToggleGroupItem>
          <ToggleGroupItem value="club" className="h-7 px-2 text-xs gap-1">
            <Building2 className="h-3 w-3" />
            Whole club
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visible.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {games.length} game{games.length === 1 ? "" : "s"} ·{" "}
          {trainings.length} training
          {scope === "my" && events && events.length > visible.length && (
            <> · {events.length - visible.length} more across club</>
          )}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              {scope === "my"
                ? "None of your teams have games or training on this day."
                : "No games or training scheduled across the club on this day."}
            </p>
            {scope === "my" && events && events.length > 0 && (
              <button
                onClick={() => setScope("club")}
                className="text-xs text-primary mt-2 underline"
              >
                See {events.length} club-wide event{events.length === 1 ? "" : "s"}
              </button>
            )}
          </CardContent>
        </Card>
      ) : scope === "club" ? (
        <div className="space-y-3">
          {byVenue.map(([venue, list]) => (
            <div key={venue} className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">{venue}</span>
                <span>({list.length})</span>
              </div>
              <div className="space-y-2">
                {list.map((e) => (
                  <DayEventRow key={e.id} event={e} hideVenue />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {games.length > 0 && (
            <SummarySection
              title="Games"
              icon={<Trophy className="h-4 w-4" />}
              accent="text-destructive"
              events={games}
            />
          )}
          {trainings.length > 0 && (
            <SummarySection
              title="Training"
              icon={<Dumbbell className="h-4 w-4" />}
              accent="text-primary"
              events={trainings}
            />
          )}
        </>
      )}
    </div>
  );
}

function SummarySection({
  title,
  icon,
  accent,
  events,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  events: ClubDayEvent[];
}) {
  return (
    <div className="space-y-2">
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", accent)}>
        {icon}
        <span>{title}</span>
        <span className="text-muted-foreground">({events.length})</span>
      </div>
      <div className="space-y-2">
        {events.map((e) => (
          <DayEventRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function DayEventRow({ event, hideVenue = false }: { event: ClubDayEvent; hideVenue?: boolean }) {
  const navigate = useNavigate();
  const time = event.start_time
    ? format(new Date(event.start_time), "h:mma").toLowerCase()
    : null;
  const venue = hideVenue ? null : venueLabel(event);
  const isTraining = event.type === "training";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/events/${event.id}`);
        }
      }}
      className="cursor-pointer hover:bg-accent/50 active:bg-accent transition-colors"
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {!hideVenue && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] py-0 h-4 shrink-0",
                    isTraining ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"
                  )}
                >
                  {isTraining ? "Training" : "Game"}
                </Badge>
              )}
              <p className="font-medium text-sm truncate">
                {event.team_name || event.title}
                {event.opponent ? (
                  <span className="text-muted-foreground"> vs {event.opponent}</span>
                ) : null}
              </p>
              {event.is_cancelled && (
                <Badge variant="destructive" className="text-[10px] py-0 h-4">
                  Cancelled
                </Badge>
              )}
            </div>
            {venue && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{venue}</span>
              </div>
            )}
            {hideVenue && isTraining && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Dumbbell className="h-3 w-3 shrink-0" />
                <span>Training</span>
              </div>
            )}
          </div>
          {time && (
            <div className="flex items-center gap-1 text-xs font-medium text-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {time}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
