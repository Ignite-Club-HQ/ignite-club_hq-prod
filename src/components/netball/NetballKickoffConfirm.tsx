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
import { Button } from "@/components/ui/button";
import { Eye, Play, Repeat } from "lucide-react";

interface NetballKickoffConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rotationIntervalMinutes: number;
  plannedSubsCount: number;
  /** Coach wants to review the plan first — opens the preview sheet. */
  onPreview: () => void;
  /** Start without reviewing. */
  onConfirm: () => void;
}

/**
 * Reminder shown when the coach taps "Ready to start" with auto-subs ON
 * but hasn't opened the preview yet. Encourages a quick check so they
 * aren't surprised by the first scheduled rotation mid-game.
 */
export default function NetballKickoffConfirm({
  open,
  onOpenChange,
  rotationIntervalMinutes,
  plannedSubsCount,
  onPreview,
  onConfirm,
}: NetballKickoffConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Repeat className="h-5 w-5 text-primary" />
          </div>
          <AlertDialogTitle className="text-center">
            Auto-subs are ready
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            We've planned{" "}
            <span className="font-semibold text-foreground">
              {plannedSubsCount} rotation{plannedSubsCount === 1 ? "" : "s"}
            </span>{" "}
            every{" "}
            <span className="font-semibold text-foreground">
              {rotationIntervalMinutes} minutes
            </span>
            . Want to preview before tip-off?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-1 gap-2 mt-2">
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() => {
              onOpenChange(false);
              onPreview();
            }}
          >
            <Eye className="h-4 w-4" />
            Preview plan first
          </Button>
        </div>
        <AlertDialogFooter className="flex-row gap-2 sm:justify-between">
          <AlertDialogCancel className="flex-1 mt-0">
            Not yet
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="flex-1 gap-2">
            <Play className="h-4 w-4" />
            Start game
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
