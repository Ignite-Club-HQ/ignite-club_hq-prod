import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, ArrowLeftRight, ArrowUpCircle } from "lucide-react";
import BasketballPlayerToken from "./BasketballPlayerToken";
import { BasketballPlayer } from "./types";
import { cn } from "@/lib/utils";

interface BasketballBenchProps {
  bench: BasketballPlayer[];
  selectedPlayerId: string | null;
  /** True when the selected player is currently on the court — bench tokens become swap targets. */
  selectedIsOnCourt?: boolean;
  /** Bench player queued to come on next (from auto-sub plan). */
  nextSubInId?: string | null;
  /** Coach-assistant: top under-played bench ids (sorted, lowest minutes first). Highlights up to 2. */
  underplayedBenchIds?: string[];
  /** When true, render a small "Sub due" badge next to the bench label. */
  showSubDueBadge?: boolean;
  recentlySwappedIds?: string[];
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  onPlayerLongPress?: (playerId: string) => void;
}

export default function BasketballBench({
  bench,
  selectedPlayerId,
  selectedIsOnCourt = false,
  nextSubInId = null,
  underplayedBenchIds = [],
  showSubDueBadge = false,
  recentlySwappedIds = [],
  readOnly = false,
  onPlayerClick,
  onPlayerLongPress,
}: BasketballBenchProps) {
  // Auto-sub plan / coach-assistant takes priority over the local fallback.
  // We keep `lowestMinutesId` for legacy single-highlight behaviour when
  // neither upstream signal is provided.
  const lowestMinutesId = useMemo(() => {
    if (nextSubInId) return null;
    if (underplayedBenchIds.length > 0) return null;
    const eligible = bench.filter((p) => !p.isInjured);
    if (eligible.length === 0) return null;
    return eligible.reduce((lo, p) =>
      (p.minutesPlayed ?? 0) < (lo.minutesPlayed ?? 0) ? p : lo
    ).id;
  }, [bench, nextSubInId, underplayedBenchIds]);

  const isEmpty = bench.length === 0;

  return (
    <div className="relative bg-card flex-shrink-0 before:content-[''] before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-gradient-to-b before:from-transparent before:to-card before:pointer-events-none">
      <div
        className={cn(
          "flex items-center justify-between px-3 py-0.5",
        )}
      >
        <h2 className="text-[11px] font-bold flex items-center gap-1 text-muted-foreground">
          <Users className="h-3 w-3" /> Bench ({bench.length})
          {showSubDueBadge && !selectedPlayerId && (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary/15 text-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide">
              Sub due
            </span>
          )}
        </h2>
        {!isEmpty && selectedPlayerId ? (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" />
            {selectedIsOnCourt ? "Tap a bench player" : "Tap to deselect"}
          </span>
        ) : !isEmpty && (nextSubInId || underplayedBenchIds.length > 0 || lowestMinutesId) ? (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowUpCircle className="h-3 w-3" /> Next up
          </span>
        ) : null}
      </div>
      {!isEmpty && (
        <ScrollArea className="w-full">
          <div className="flex gap-1.5 px-2 pb-1.5">
            {bench.map((p) => {
              const isSelected = selectedPlayerId === p.id;
              const isSwapTarget = !!selectedPlayerId && selectedIsOnCourt && !isSelected;
              const isUnderplayed = underplayedBenchIds.includes(p.id);
              return (
                <BasketballPlayerToken
                  key={p.id}
                  player={p}
                  variant="bench"
                  isSelected={isSelected}
                  isSwapTarget={isSwapTarget}
                  isRecentlySwapped={recentlySwappedIds.includes(p.id)}
                  isNextSub={nextSubInId === p.id}
                  // Either upstream "next up" highlight OR the legacy fallback.
                  isLowestMinutes={isUnderplayed || lowestMinutesId === p.id}
                  onClick={() => onPlayerClick(p.id)}
                  onLongPress={onPlayerLongPress ? () => onPlayerLongPress(p.id) : undefined}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
