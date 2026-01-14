import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, MapPin, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, isAfter, subDays } from "date-fns";

interface LandscapeEventSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  currentEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
}

interface GameEvent {
  id: string;
  title: string;
  event_date: string;
  type: string;
  address: string | null;
  suburb: string | null;
  opponent: string | null;
}

export function LandscapeEventSelector({
  open,
  onOpenChange,
  teamId,
  currentEventId,
  onSelectEvent,
}: LandscapeEventSelectorProps) {
  // Fetch game events for the selector
  // Only show games from the last 24 hours (for past games) or future games
  const { data: gameEvents, isLoading } = useQuery({
    queryKey: ["team-game-events-selector", teamId],
    queryFn: async () => {
      const oneDayAgo = subDays(new Date(), 1);
      
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, type, address, suburb, opponent")
        .eq("team_id", teamId)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("event_date", oneDayAgo.toISOString())
        .order("event_date", { ascending: true })
        .limit(20);

      if (error) throw error;
      return data as GameEvent[];
    },
    enabled: !!teamId && open,
  });

  const formatShortDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "MMM d, h:mm a");
    } catch {
      return dateStr;
    }
  };

  const isUpcoming = (dateStr: string) => {
    try {
      return isAfter(parseISO(dateStr), new Date());
    } catch {
      return false;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="bottom" 
        className="h-[70vh] rounded-t-xl"
        style={{ zIndex: 100001 }}
      >
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Link a Game
          </SheetTitle>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="space-y-2 pr-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading games...
              </div>
            ) : gameEvents && gameEvents.length > 0 ? (
              <div className="space-y-1">
                {gameEvents.map((game) => {
                  const isSelected = game.id === currentEventId;
                  const gameOpponent = game.opponent || game.title.match(/\bvs?\b\s*(.+)/i)?.[1]?.trim();
                  
                  return (
                    <button
                      key={game.id}
                      onClick={() => onSelectEvent(game.id)}
                      className={`w-full p-3 rounded-xl text-left transition-all ${
                        isSelected 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-muted/50 hover:bg-muted active:scale-[0.98]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Calendar className={`h-4 w-4 shrink-0 ${isSelected ? "" : "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{game.title}</p>
                            {gameOpponent && (
                              <p className={`text-xs truncate ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                vs {gameOpponent}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isUpcoming(game.event_date) && !isSelected && (
                            <Badge variant="outline" className="text-[10px]">Upcoming</Badge>
                          )}
                          {isSelected && (
                            <Check className="h-4 w-4" />
                          )}
                        </div>
                      </div>
                      <div className={`flex items-center gap-3 mt-1 text-xs ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatShortDate(game.event_date)}
                        </span>
                        {game.suburb && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3" />
                            {game.suburb}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No games found for this team
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
