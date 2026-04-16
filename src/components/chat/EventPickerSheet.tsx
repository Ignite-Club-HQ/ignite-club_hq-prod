import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Calendar, Clock, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface EventPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  teamId?: string;
  clubId?: string;
}

export function EventPickerSheet({ open, onOpenChange, onSelectEvent, teamId, clubId }: EventPickerSheetProps) {
  const [search, setSearch] = useState("");
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: events, isLoading } = useQuery({
    queryKey: ["event-picker", teamId, clubId],
    queryFn: async () => {
      let query = supabase
        .from("events")
        .select("id, title, event_date, start_time, location_name, location, type, opponent, mini_league_id, is_cancelled")
        .eq("is_cancelled", false)
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(30);

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else if (clubId) {
        // Get all events for any team in this club
        const { data: teams } = await supabase
          .from("teams")
          .select("id")
          .eq("club_id", clubId);
        const teamIds = teams?.map(t => t.id) || [];
        if (teamIds.length > 0) {
          query = query.in("team_id", teamIds);
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data } = await query;
      return data || [];
    },
    enabled: open && !!(teamId || clubId),
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!events) return [];
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.opponent?.toLowerCase().includes(q)
    );
  }, [events, search]);

  const handleSelect = (eventId: string) => {
    onSelectEvent(eventId);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh] flex flex-col overflow-hidden">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Share Event</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1.5">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {search ? "No events match your search" : "No upcoming events"}
            </p>
          ) : (
            filtered.map(event => {
              const eventDate = parseISO(event.event_date);
              const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: event.mini_league_id });
              const loc = event.location_name || event.location;

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleSelect(event.id)}
                  className="flex items-center gap-2.5 w-full rounded-lg border border-border/50 p-2.5 text-left transition-colors active:bg-muted/50 hover:bg-muted/30 touch-manipulation"
                >
                  <div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 p-1.5 min-w-[38px]">
                    <span className="text-[10px] font-semibold text-primary uppercase leading-none">
                      {format(eventDate, "EEE")}
                    </span>
                    <span className="text-sm font-bold text-primary leading-tight">
                      {format(eventDate, "d")}
                    </span>
                    <span className="text-[9px] text-primary/70 uppercase leading-none">
                      {format(eventDate, "MMM")}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-primary uppercase">{typeLabel}</span>
                    </div>
                    <p className="text-sm font-medium truncate">
                      {event.title}
                      {event.opponent && (
                        <span className="text-muted-foreground font-normal"> vs {event.opponent}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {event.start_time && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {format(new Date(event.start_time), "h:mm a")}
                        </span>
                      )}
                      {loc && (
                        <span className="flex items-center gap-0.5 truncate max-w-[120px]">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          {loc}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
