import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { MapPin, Clock, Trophy, Dumbbell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ClubDaySummaryProps {
  selectedDate: Date;
  clubIds: string[];
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

/**
 * Club-wide summary for a single day. Shows ALL games and training scheduled
 * across the user's club(s) on the selected date — not just the teams the
 * user is a member of. Backed by `get_club_day_events` SECURITY DEFINER fn.
 */
export function ClubDaySummary({ selectedDate, clubIds }: ClubDaySummaryProps) {
  const dKey = dayKey(selectedDate);

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
      // Sort by start_time, then event_date
      return all.sort((a, b) => {
        const at = a.start_time || a.event_date;
        const bt = b.start_time || b.event_date;
        return at.localeCompare(bt);
      });
    },
    enabled: clubIds.length > 0,
    staleTime: 60 * 1000,
  });

  const games = (events || []).filter((e) => e.type === "game");
  const trainings = (events || []).filter((e) => e.type === "training");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {format(selectedDate, "EEEE, MMMM d")}
        </h2>
        {events && events.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {games.length} game{games.length === 1 ? "" : "s"} ·{" "}
            {trainings.length} training
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !events || events.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              No games or training scheduled across the club on this day.
            </p>
          </CardContent>
        </Card>
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

function DayEventRow({ event }: { event: ClubDayEvent }) {
  const time = event.start_time
    ? format(new Date(event.start_time), "h:mma").toLowerCase()
    : null;
  const venue =
    event.location_name ||
    [event.address, event.suburb].filter(Boolean).join(", ") ||
    null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
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
