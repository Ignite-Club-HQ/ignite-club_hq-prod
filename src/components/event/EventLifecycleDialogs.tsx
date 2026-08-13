import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Scope = "single" | "series";

export function EventCancellationDialog({ recurring, open, onOpenChange, event, isPending, onCancel }: {
  recurring: boolean; open: boolean; onOpenChange: (open: boolean) => void; event: any; isPending: boolean;
  onCancel: (scope: Scope, customMessage: string, sendPushNotification: boolean) => void;
}) {
  return recurring ? <RecurringCancelEventDialog
    open={open} onOpenChange={onOpenChange} eventTitle={event.title}
    teamId={event.team_id} clubId={event.club_id} miniLeagueId={event.mini_league_id} eventType={event.type}
    onSingleAction={(message, push) => onCancel("single", message, push)}
    onSeriesAction={(message, push) => onCancel("series", message, push)} isPending={isPending}
  /> : <CancelEventConfirmDialog
    open={open} onOpenChange={onOpenChange} eventId={event.id} eventTitle={event.title}
    teamId={event.team_id} clubId={event.club_id} miniLeagueId={event.mini_league_id} eventType={event.type}
    onConfirm={(message, push) => onCancel("single", message, push)} isPending={isPending}
  />;
}

export function EventDeletionDialog({ recurring, open, onOpenChange, eventTypeLabel, isPending, onDelete }: {
  recurring: boolean; open: boolean; onOpenChange: (open: boolean) => void; eventTypeLabel: string;
  isPending: boolean; onDelete: (scope: Scope) => void;
}) {
  return recurring ? <RecurringEventActionDialog
    open={open} onOpenChange={onOpenChange} title={`Delete ${eventTypeLabel}?`}
    description={`This will permanently delete the ${eventTypeLabel.toLowerCase()}(s) and all RSVPs. This action cannot be undone.`}
    actionLabel="Delete" actionVariant="destructive" onSingleAction={() => onDelete("single")}
    onSeriesAction={() => onDelete("series")} isPending={isPending} keepOpenOnAction
  /> : <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>Delete {eventTypeLabel}?</AlertDialogTitle>
      <AlertDialogDescription>This will permanently delete this {eventTypeLabel.toLowerCase()} and all RSVPs. This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={(event) => { event.preventDefault(); onDelete("single"); }} disabled={isPending} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}
