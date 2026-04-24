import { memo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarCheck, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useUpcomingTrainingEvents,
  useSaveSessionToEvent,
} from "@/hooks/useDrillLibrary";

interface SaveToEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  /** Drill IDs (in order) currently in today's session strip. */
  drillIds: string[];
}

function SaveToEventDialogImpl({
  open,
  onOpenChange,
  teamId,
  drillIds,
}: SaveToEventDialogProps) {
  const { data: events, isLoading } = useUpcomingTrainingEvents(
    open ? teamId : null,
  );
  const saveMut = useSaveSessionToEvent();
  const [selected, setSelected] = useState<string | null>(null);

  const handleSave = () => {
    if (!selected) return;
    saveMut.mutate(
      { eventId: selected, drillIds },
      {
        onSuccess: () => {
          toast.success("Session saved to training event");
          onOpenChange(false);
          setSelected(null);
        },
        onError: (err: any) =>
          toast.error(err?.message ?? "Failed to save session"),
      },
    );
  };

  const formatWhen = (e: { event_date: string; start_time: string | null }) => {
    try {
      const d = parseISO(e.event_date);
      const day = format(d, "EEE d MMM");
      return e.start_time ? `${day} · ${e.start_time.slice(0, 5)}` : day;
    } catch {
      return e.event_date;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save session to training event</DialogTitle>
          <DialogDescription>
            Attach today's {drillIds.length} drill
            {drillIds.length === 1 ? "" : "s"} to a training event so the plan is
            visible to other coaches.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[180px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading events…
            </div>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No upcoming training events for this team.
            </div>
          ) : (
            <ScrollArea className="max-h-[280px] pr-2">
              <div className="space-y-1.5">
                {events.map((e) => {
                  const isSel = selected === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelected(e.id)}
                      className={cn(
                        "w-full text-left flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                        isSel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <CalendarCheck
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSel ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {e.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatWhen(e)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!selected || saveMut.isPending || drillIds.length === 0}
          >
            {saveMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving…
              </>
            ) : (
              "Save to event"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const SaveToEventDialog = memo(SaveToEventDialogImpl);
