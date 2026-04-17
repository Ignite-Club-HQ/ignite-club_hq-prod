import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X, Target } from "lucide-react";

interface FreeThrowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerName: string;
  /** Number of free throws to shoot (1, 2 or 3). */
  attempts: 1 | 2 | 3;
  /** Called once the coach taps Done — `made` is the count of made shots. */
  onComplete: (made: number, attempted: number) => void;
}

/**
 * Sequential free-throw entry.
 * Coach taps Make / Miss for each attempt, then Done.
 * Each Make credits +1 point to the shooting player and updates FT%.
 */
export default function FreeThrowDialog({
  open,
  onOpenChange,
  playerName,
  attempts,
  onComplete,
}: FreeThrowDialogProps) {
  // results[i] = true (make) | false (miss) | null (pending)
  const [results, setResults] = useState<(boolean | null)[]>(() =>
    Array.from({ length: attempts }).map(() => null)
  );

  // Reset when the dialog opens with a new attempt count.
  const resetIfNeeded = () => {
    if (results.length !== attempts) {
      setResults(Array.from({ length: attempts }).map(() => null));
    }
  };
  resetIfNeeded();

  const setResult = (idx: number, made: boolean) => {
    setResults((prev) => prev.map((r, i) => (i === idx ? made : r)));
  };

  const allDone = results.every((r) => r !== null);
  const madeCount = results.filter((r) => r === true).length;

  const handleDone = () => {
    // Treat any pending as a miss so the coach can leave early without losing data.
    const finalised = results.map((r) => r === true);
    const made = finalised.filter(Boolean).length;
    onComplete(made, attempts);
    setResults(Array.from({ length: attempts }).map(() => null));
    onOpenChange(false);
  };

  const handleCancel = () => {
    setResults(Array.from({ length: attempts }).map(() => null));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleCancel())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Free throws — {playerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {results.map((r, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-lg border bg-card p-2"
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-xs font-bold">
                {idx + 1}
              </span>
              <Button
                size="sm"
                variant={r === true ? "default" : "outline"}
                className={cn("flex-1 h-10", r === true && "bg-emerald-600 hover:bg-emerald-700")}
                onClick={() => setResult(idx, true)}
              >
                <Check className="h-4 w-4 mr-1" />
                Make
              </Button>
              <Button
                size="sm"
                variant={r === false ? "destructive" : "outline"}
                className="flex-1 h-10"
                onClick={() => setResult(idx, false)}
              >
                <X className="h-4 w-4 mr-1" />
                Miss
              </Button>
            </div>
          ))}

          <p className="text-center text-xs text-muted-foreground pt-1">
            {madeCount}/{attempts} made · {allDone ? "Ready" : "Tap each shot"}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleDone}>Done · +{madeCount}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
