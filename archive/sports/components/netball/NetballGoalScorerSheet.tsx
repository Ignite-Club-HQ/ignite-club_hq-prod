import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Target, MinusCircle } from "lucide-react";
import { NetballPlayer } from "./types";
import { cn } from "@/lib/utils";

interface NetballGoalScorerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Eligible scorers currently on court (typically GS + GA). */
  candidates: NetballPlayer[];
  /** Attribute the goal to a specific player. */
  onAttribute: (playerId: string) => void;
  /** Record the goal without attributing it to any player. */
  onSkip: () => void;
}

/**
 * Bottom sheet that asks the coach which on-court attacker scored the
 * goal that's about to be added to the home tally.
 *
 * Designed to disappear in a single tap: the candidates (GS / GA) and a
 * "Don't attribute" escape hatch are all primary, equally-weighted
 * actions so the coach never has to scroll or hunt.
 */
export default function NetballGoalScorerSheet({
  open,
  onOpenChange,
  candidates,
  onAttribute,
  onSkip,
}: NetballGoalScorerSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl pb-safe">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Who scored?
          </SheetTitle>
          <SheetDescription>
            Tap the goal scorer to credit them, or skip to log an unattributed goal.
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-1 gap-2 py-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No GS or GA on court right now.
            </p>
          ) : (
            candidates.map((p) => (
              <Button
                key={p.id}
                variant="default"
                className="h-14 justify-start gap-3 text-base"
                onClick={() => {
                  onAttribute(p.id);
                  onOpenChange(false);
                }}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-primary-foreground/20 text-primary-foreground text-xs font-bold",
                  )}
                >
                  {p.position}
                </span>
                <span className="truncate">{p.name}</span>
                {(p.goals ?? 0) > 0 && (
                  <span className="ml-auto text-xs opacity-80 tabular-nums">
                    {p.goals} goal{p.goals === 1 ? "" : "s"}
                  </span>
                )}
              </Button>
            ))
          )}

          <Button
            variant="outline"
            className="h-12 justify-start gap-3"
            onClick={() => {
              onSkip();
              onOpenChange(false);
            }}
          >
            <MinusCircle className="h-5 w-5" />
            <span>Don't attribute</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
