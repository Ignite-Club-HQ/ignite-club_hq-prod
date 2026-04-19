import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { NetballSubEvent, Quarter } from "./types";

interface NetballQuarterBreakDialogProps {
  open: boolean;
  quarter: Quarter | null;
  subs: NetballSubEvent[];
  onConfirm: () => void;
  onSkip: () => void;
}

/**
 * Shown at quarter breaks (only in `quarter-break` rotation mode) to preview
 * the planned subs. Coach can apply or skip the rotation for that quarter.
 * Mirrors BasketballQuarterBreakDialog.
 */
export default function NetballQuarterBreakDialog({
  open,
  quarter,
  subs,
  onConfirm,
  onSkip,
}: NetballQuarterBreakDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSkip()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Q{quarter} rotation</DialogTitle>
          <DialogDescription>
            Review the planned subs before they go on. You can apply them all or skip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2 max-h-72 overflow-y-auto">
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No subs planned.
            </p>
          ) : (
            subs.map((sub, idx) => (
              <div
                key={`${sub.playerOut.id}-${idx}`}
                className="flex items-center gap-2 rounded-lg border bg-card p-2 text-sm"
              >
                <span className="px-2 py-0.5 rounded bg-muted text-xs font-bold">
                  {sub.position}
                </span>
                <span className="flex-1 truncate font-medium text-destructive">
                  {sub.playerOut.name}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate font-medium text-primary">
                  {sub.playerIn.name}
                </span>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button onClick={onConfirm} className="flex-1" disabled={subs.length === 0}>
            Apply {subs.length > 0 ? `(${subs.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
