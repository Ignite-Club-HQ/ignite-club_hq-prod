import { format, parseISO } from "date-fns";
import { CalendarPlus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EventDateCalendarRow({ eventDate, onExport }: { eventDate: string; onExport: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Clock className="h-5 w-5 text-primary" />
      <span className="flex-1">{format(parseISO(eventDate), "EEEE, MMMM d 'at' h:mm a")}</span>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 h-8 w-8 -mr-2"
        aria-label="Add to calendar"
        title="Add to calendar"
        onClick={onExport}
      >
        <CalendarPlus className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
