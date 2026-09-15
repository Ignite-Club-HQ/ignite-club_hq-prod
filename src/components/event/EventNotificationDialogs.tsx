import { Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function EventReminderDialog({ open, onOpenChange, onShare, onSend, isPending, actionsDisabled }: {
  open: boolean; onOpenChange: (open: boolean) => void; onShare: () => void; onSend: () => void;
  isPending: boolean; actionsDisabled: boolean;
}) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Send RSVP Reminders?</AlertDialogTitle>
        <AlertDialogDescription>This will send a notification to all team members who haven't responded to this event yet.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
        <Button variant="outline" className="w-full sm:w-auto gap-1.5" onClick={onShare}>
          <Share2 className="h-4 w-4" />Share via...
        </Button>
        <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onSend} disabled={isPending || actionsDisabled} className="w-full sm:w-auto">
          {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : "Send In-App"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function EventResendInvitesDialog({ open, onOpenChange, onSend, isPending, actionsDisabled }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSend: () => void;
  isPending: boolean; actionsDisabled: boolean;
}) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Resend Event Invites?</AlertDialogTitle>
        <AlertDialogDescription>This will send notifications to any new members who haven't been notified about this event yet.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onSend} disabled={isPending || actionsDisabled}>
          {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : "Send Invites"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
