import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
  Image as ImageIcon,
  Repeat,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ScheduleTarget,
  ScheduledMessageRow,
  useCancelScheduledMessage,
  useThreadScheduledMessages,
} from "@/hooks/useScheduledMessages";
import {
  ScheduleMessageDialog,
  localTimezoneLabel,
} from "./ScheduleMessageDialog";

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

interface ScheduledMessagesBannerProps {
  target: ScheduleTarget;
}

export function ScheduledMessagesBanner({ target }: ScheduledMessagesBannerProps) {
  const {
    data: rows = [],
    isError,
    refetch,
    isFetching,
  } = useThreadScheduledMessages(target);
  const [expanded, setExpanded] = useState(false);
  const [editingRow, setEditingRow] = useState<ScheduledMessageRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const cancelMut = useCancelScheduledMessage();

  // If the fetch failed and we have no cached rows to show, still surface a
  // non-blocking warning so the user knows their previously scheduled
  // messages may still send. Never imply the list is empty on error.
  if (rows.length === 0) {
    if (!isError) return null;
    return (
      <div
        role="alert"
        className="bg-amber-500/10 border-b border-amber-500/40 px-3 py-2 flex items-start gap-2"
      >
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground">
            Scheduled messages could not be loaded. Your existing messages have
            not been deleted and may still send.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
        >
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  const handleCancel = async () => {
    if (!confirmDeleteId) return;
    try {
      await cancelMut.mutateAsync(confirmDeleteId);
      toast.success("Scheduled message cancelled");
    } catch (e: any) {
      if (e?.code === "session_expired") {
        toast.error("Your session expired. Please sign in again.");
      } else {
        toast.error(e?.message || "Failed to cancel");
      }
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <>
      <div className="bg-primary/5 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">
              {rows.length} scheduled message{rows.length === 1 ? "" : "s"}
            </span>
            {!expanded && rows[0] && (
              <span className="text-xs text-muted-foreground truncate">
                · next in {formatDistanceToNow(new Date(rows[0].scheduled_for))}
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {expanded && (
          <>
            <ul className="mt-2 space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-2 rounded-md bg-background/60 border border-border p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(row.scheduled_for), "EEE, MMM d 'at' h:mm a")}
                      </p>
                      {row.recurrence && row.recurrence !== "none" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          <Repeat className="h-2.5 w-2.5" />
                          {RECURRENCE_LABELS[row.recurrence] || row.recurrence}
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-1.5 mt-0.5">
                      {row.image_url && (
                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                      <p className="text-sm break-words line-clamp-2">
                        {row.text || (row.image_url ? "(Image only)" : "")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditingRow(row)}
                      aria-label="Edit scheduled message"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setConfirmDeleteId(row.id)}
                      aria-label="Cancel scheduled message"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Times shown in {localTimezoneLabel()}
            </p>
          </>
        )}
      </div>

      <ScheduleMessageDialog
        open={!!editingRow}
        onOpenChange={(o) => !o && setEditingRow(null)}
        target={target}
        editingRow={editingRow}
      />

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scheduled message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message won't be sent. You can always schedule a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>Cancel message</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
