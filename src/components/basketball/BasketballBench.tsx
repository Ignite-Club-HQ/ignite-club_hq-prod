import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, ArrowLeftRight, ArrowUpCircle } from "lucide-react";
import BasketballPlayerToken from "./BasketballPlayerToken";
import { BasketballPlayer } from "./types";

interface BasketballBenchProps {
  bench: BasketballPlayer[];
  selectedPlayerId: string | null;
  /** Bench player queued to come on next (from auto-sub plan). */
  nextSubInId?: string | null;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
}

export default function BasketballBench({
  bench,
  selectedPlayerId,
  nextSubInId = null,
  readOnly = false,
  onPlayerClick,
}: BasketballBenchProps) {
  // Auto-sub takes priority. Otherwise highlight the lowest-minutes
  // bench player so the coach sees who's "owed" the most game time.
  const lowestMinutesId = useMemo(() => {
    if (nextSubInId) return null;
    const eligible = bench.filter((p) => !p.isInjured);
    if (eligible.length === 0) return null;
    return eligible.reduce((lo, p) =>
      (p.minutesPlayed ?? 0) < (lo.minutesPlayed ?? 0) ? p : lo
    ).id;
  }, [bench, nextSubInId]);

  return (
    <div className="border-t bg-card">
      <div className="flex items-center justify-between px-3 py-1.5">
        <h2 className="text-xs font-bold flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Bench ({bench.length})
        </h2>
        {selectedPlayerId ? (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" /> Tap a player or empty slot
          </span>
        ) : (nextSubInId || lowestMinutesId) ? (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowUpCircle className="h-3 w-3" /> Next up
          </span>
        ) : null}
      </div>
      <ScrollArea className="w-full">
        <div className="flex gap-2 px-3 pb-3 min-h-[68px]">
          {bench.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3">No bench players.</p>
          ) : (
            bench.map((p) => (
              <BasketballPlayerToken
                key={p.id}
                player={p}
                variant="bench"
                isSelected={selectedPlayerId === p.id}
                isSwapTarget={!!selectedPlayerId && selectedPlayerId !== p.id}
                isNextSub={nextSubInId === p.id}
                isLowestMinutes={lowestMinutesId === p.id}
                onClick={() => onPlayerClick(p.id)}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
