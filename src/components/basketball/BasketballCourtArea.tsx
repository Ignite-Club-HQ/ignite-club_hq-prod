import { cn } from "@/lib/utils";
import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  POSITION_SLOTS,
} from "./types";
import BasketballCourt from "./BasketballCourt";
import BasketballPlayerToken from "./BasketballPlayerToken";
import { findPlayerInPosition } from "./basketballHelpers";

interface BasketballCourtAreaProps {
  players: BasketballPlayer[];
  selectedPlayerId: string | null;
  nextSubOutId?: string | null;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  onSlotClick: (position: BasketballPosition) => void;
}

/**
 * Renders the half-court SVG with 5 soft position slots.
 * Slots are visual hints only — any player can occupy any slot (free movement).
 */
export default function BasketballCourtArea({
  players,
  selectedPlayerId,
  nextSubOutId,
  readOnly = false,
  onPlayerClick,
  onSlotClick,
}: BasketballCourtAreaProps) {
  return (
    <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-muted/40 p-2">
      <div className="relative w-full max-w-sm aspect-[5/7] mx-auto">
        <BasketballCourt className="absolute inset-0 w-full h-full rounded-lg" />

        {BASKETBALL_POSITIONS.map((pos) => {
          const slot = POSITION_SLOTS[pos];
          const player = findPlayerInPosition(players, pos);
          return (
            <div
              key={pos}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              {player ? (
                <BasketballPlayerToken
                  player={player}
                  position={pos}
                  variant="court"
                  isSelected={selectedPlayerId === player.id}
                  isSwapTarget={!!selectedPlayerId && selectedPlayerId !== player.id}
                  isNextSub={nextSubOutId === player.id}
                  onClick={() => onPlayerClick(player.id)}
                  readOnly={readOnly}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSlotClick(pos)}
                  className={cn(
                    "w-12 h-12 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center text-[10px] font-bold text-white/70 hover:border-white/80 transition",
                    selectedPlayerId && "border-primary text-primary animate-pulse"
                  )}
                  aria-label={`Empty ${pos} slot`}
                >
                  {pos}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
