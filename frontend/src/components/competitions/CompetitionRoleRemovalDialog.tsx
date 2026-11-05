import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
export function CompetitionRoleRemovalDialog({ open, onOpenChange, onConfirm, pending, self }: {
  open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; pending: boolean; self: boolean;
}) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{self ? "Leave this competition role?" : "Remove this competition role?"}</AlertDialogTitle>
        <AlertDialogDescription>
          Only this role will be removed. Other competition roles and club or team roles stay unchanged.
          {self && " Organiser-club admins may still manage the competition through their club role."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <Button variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? "Removing…" : self ? "Leave role" : "Remove role"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}