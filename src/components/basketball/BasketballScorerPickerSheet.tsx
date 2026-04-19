import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import type { BasketballPlayer } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The points value being attributed (1, 2, or 3). */
  points: number | null;
  /** Players currently on court — sorted by minutes played descending. */
  onCourt: BasketballPlayer[];
  /**
   * Called with the chosen player id, or null when the coach skips
   * attribution (the score should still be added as team-only).
   */
  onPick: (playerId: string | null) => void;
}

/**
 * Quick prompt that pops up after a coach taps +1 / +2 / +3 on the home side.
 * Shows on-court players large enough to thumb-tap on a sideline. The coach
 * can also tap "Team only" to skip player attribution.
 */
export default function BasketballScorerPickerSheet({
  open,
  onOpenChange,
  points,
  onCourt,
  onPick,
}: Props) {
  const sorted = useMemo(
    () =>
      [...onCourt].sort(
        (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
      ),
    [onCourt]
  );

  const label = points === 3 ? "3-pointer" : points === 2 ? "2-pointer" : "Free throw";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary text-primary-foreground px-2 text-sm font-bold tabular-nums">
              +{points ?? "?"}
            </span>
            Who scored the {label}?
          </SheetTitle>
          <SheetDescription className="text-xs">
            Tap a player to credit them. Skip if you don't want to attribute.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sorted.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              No players on court.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {sorted.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPick(p.id)}
                  className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card hover:bg-accent active:bg-accent/80 px-3 py-2.5 text-left transition-colors"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">
                      {p.number ? `#${p.number} ` : ""}
                      {p.name}
                    </span>
                    <span className="text-xs font-bold text-primary tabular-nums">
                      {p.points ?? 0}pts
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                    {p.position && (
                      <span className="font-mono uppercase">{p.position}</span>
                    )}
                    <span>1pt: {p.pointsBy1 ?? 0}</span>
                    <span>2pt: {p.pointsBy2 ?? 0}</span>
                    <span>3pt: {p.pointsBy3 ?? 0}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t bg-background px-4 py-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => onPick(null)}
          >
            <Users className="h-4 w-4" />
            Team only
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
