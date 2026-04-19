import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, ArrowLeftRight, ArrowUpCircle } from "lucide-react";
import NetballPlayerToken from "./NetballPlayerToken";
import { NetballPlayer } from "./types";

interface NetballBenchProps {
  bench: NetballPlayer[];
  selectedPlayerId: string | null;
  /** Bench player who is queued to come on next (from auto-sub plan). */
  nextSubInId?: string | null;
  /** True when the currently-selected player is on the court (so bench tokens
   * are valid swap targets — drives the "ON" pulse badge). */
  selectedIsOnCourt?: boolean;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  /** Long-press opens the player's quick action sheet (mark injured, etc.). */
  onPlayerLongPress?: (playerId: string) => void;
}

export default function NetballBench({
  bench,
  selectedPlayerId,
  nextSubInId = null,
  selectedIsOnCourt = false,
  readOnly = false,
  onPlayerClick,
  onPlayerLongPress,
}: NetballBenchProps) {
  // Fallback: highlight bench player with lowest minutes when no auto-sub
  // is queued — gives the coach a "next up" cue based on equal-time fairness.
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
          <span className="text-[10px] text-primary font-bold flex items-center gap-1 animate-pulse">
            <ArrowLeftRight className="h-3 w-3" />
            {selectedIsOnCourt ? "Tap a bench player to sub on" : "Tap a court slot or player"}
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
              <NetballPlayerToken
                key={p.id}
                player={p}
                variant="bench"
                isSelected={selectedPlayerId === p.id}
                // Bench tokens are valid swap targets only when the picked-up
                // player is on the court (court→bench sub). Bench→bench swaps
                // are nonsensical, so we don't pulse them.
                isSwapTarget={
                  !!selectedPlayerId &&
                  selectedPlayerId !== p.id &&
                  selectedIsOnCourt &&
                  !p.isInjured
                }
                isNextSub={nextSubInId === p.id || lowestMinutesId === p.id}
                onClick={() => onPlayerClick(p.id)}
                onLongPress={onPlayerLongPress ? () => onPlayerLongPress(p.id) : undefined}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
