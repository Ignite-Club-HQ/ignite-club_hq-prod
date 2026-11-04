import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addToGoogleCalendar, calendarExportError, exportEventIcs, mapEventToCalendar, type CalendarSource } from "@/lib/icsExport";
import type { useToast } from "@/hooks/use-toast";

export function CalendarExportMenu({ event, toast }: { event: CalendarSource; toast: ReturnType<typeof useToast>["toast"] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 -mr-2" aria-label="Add to calendar" title="Add to calendar">
          <CalendarPlus className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={async () => {
          try {
            await exportEventIcs(mapEventToCalendar(event));
            toast({ title: "Calendar file ready", description: "Open it to add this event to your calendar." });
          } catch (error) {
            toast({ title: "Couldn't export event", description: calendarExportError(error), variant: "destructive" });
          }
        }}>Add to calendar (.ics)</DropdownMenuItem>
        <DropdownMenuItem onSelect={async () => {
          try { await addToGoogleCalendar(mapEventToCalendar(event)); }
          catch (error) { toast({ title: "Couldn't open Google Calendar", description: calendarExportError(error), variant: "destructive" }); }
        }}>Add to Google Calendar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}