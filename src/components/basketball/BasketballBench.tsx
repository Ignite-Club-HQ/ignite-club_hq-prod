import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, ArrowLeftRight } from "lucide-react";
import BasketballPlayerToken from "./BasketballPlayerToken";
import { BasketballPlayer } from "./types";

interface BasketballBenchProps {
  bench: BasketballPlayer[];
  selectedPlayerId: string | null;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
}

export default function BasketballBench({
  bench,
  selectedPlayerId,
  readOnly = false,
  onPlayerClick,
}: BasketballBenchProps) {
  // Highlight the bench player(s) with the lowest minutes — they're "next up".
  const lowestMinutesId = useMemo(() => {
    const eligible = bench.filter(p => !p.isInjured);
    if (eligible.length === 0) return null;
    return eligible.reduce((lo, p) =>
      (p.minutesPlayed ?? 0) < (lo.minutesPlayed ?? 0) ? p : lo
    ).id;
  }, [bench]);

  return (
    <div className="border-t bg-card">
      <div className="flex items-center justify-between px-3 py-1.5">
        <h2 className="text-xs font-bold flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Bench ({bench.length})
        </h2>
        {selectedPlayerId && (
          <span className="text-[10px] text-primary font-medium flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" /> Tap a player or empty slot
          </span>
        )}
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
