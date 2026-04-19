import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, ArrowLeftRight } from "lucide-react";
import NetballPlayerToken from "./NetballPlayerToken";
import { NetballPlayer } from "./types";
import { cn } from "@/lib/utils";

interface NetballBenchProps {
  bench: NetballPlayer[];
  selectedPlayerId: string | null;
  /** True when the selected player is on the court — bench tokens become swap targets. */
  selectedIsOnCourt?: boolean;
  /** Bench player queued to come on next (from auto-sub plan). */
  nextSubInId?: string | null;
  /** Top under-played bench ids — drives "most rested" dot. */
  underplayedBenchIds?: string[];
  /** Subtle dot next to the bench label when a sub is due. */
  showSubDueBadge?: boolean;
  recentlySwappedIds?: string[];
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  onPlayerLongPress?: (playerId: string) => void;
}

/**
 * Restyled to mirror BasketballBench: subtle muted bench tray, dot
 * indicators instead of loud text labels, comfortable padding so chip ·
 * name · time read with breathing room.
 */
export default function NetballBench({
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
}: NetballBenchProps) {
  const lowestMinutesId = useMemo(() => {
    if (nextSubInId) return null;
    if (underplayedBenchIds.length > 0) return null;
    const eligible = bench.filter((p) => !p.isInjured);
    if (eligible.length === 0) return null;
    return eligible.reduce((lo, p) =>
      (p.minutesPlayed ?? 0) < (lo.minutesPlayed ?? 0) ? p : lo,
    ).id;
  }, [bench, nextSubInId, underplayedBenchIds]);

  const isEmpty = bench.length === 0;

  return (
    <div
      className={cn(
        "relative flex-shrink-0",
        "bg-muted/40 border-t border-border/60",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        "before:content-[''] before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-gradient-to-b before:from-transparent before:to-muted/40 before:pointer-events-none",
      )}
    >
      <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
        <h2 className="text-[11px] font-bold flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3 w-3" /> Bench ({bench.length})
          {showSubDueBadge && !selectedPlayerId && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.7)] animate-pulse"
              aria-label="Sub due"
            />
          )}
        </h2>
        {!isEmpty && selectedPlayerId ? (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" />
            {selectedIsOnCourt ? "Tap a bench player" : "Tap to deselect"}
          </span>
        ) : null}
      </div>
      {!isEmpty && (
        <ScrollArea className="w-full">
          <div className="flex gap-2.5 px-2.5 pt-2 pb-3">
            {bench.map((p) => {
              const isSelected = selectedPlayerId === p.id;
              const isSwapTarget = !!selectedPlayerId && selectedIsOnCourt && !isSelected;
              const isUnderplayed = underplayedBenchIds.includes(p.id);
              return (
                <NetballPlayerToken
                  key={p.id}
                  player={p}
                  variant="bench"
                  isSelected={isSelected}
                  isSwapTarget={isSwapTarget}
                  isRecentlySwapped={recentlySwappedIds.includes(p.id)}
                  isNextSub={nextSubInId === p.id}
                  isLowestMinutes={isUnderplayed || lowestMinutesId === p.id}
                  onClick={() => onPlayerClick(p.id)}
                  onLongPress={
                    onPlayerLongPress ? () => onPlayerLongPress(p.id) : undefined
                  }
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
