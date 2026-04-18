import { cn } from "@/lib/utils";
import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  POSITION_SLOTS,
  POSITION_SLOTS_FULL,
  BasketballCourtView,
} from "./types";
import BasketballCourt from "./BasketballCourt";
import BasketballFullCourt from "./BasketballFullCourt";
import BasketballPlayerToken from "./BasketballPlayerToken";
import { findPlayerInPosition } from "./basketballHelpers";

interface BasketballCourtAreaProps {
  players: BasketballPlayer[];
  selectedPlayerId: string | null;
  nextSubOutId?: string | null;
  readOnly?: boolean;
  courtView?: BasketballCourtView;
  /** When true, empty position slots render nothing (used in live mode after tip-off). */
  hideEmptySlots?: boolean;
  onPlayerClick: (playerId: string) => void;
  onSlotClick: (position: BasketballPosition) => void;
}

/**
 * Renders the court SVG (half by default, full optionally) with 5 soft
 * position slots. Slots are visual hints only — any player can occupy any slot.
 */
export default function BasketballCourtArea({
  players,
  selectedPlayerId,
  nextSubOutId,
  readOnly = false,
  courtView = "half",
  hideEmptySlots = false,
  onPlayerClick,
  onSlotClick,
}: BasketballCourtAreaProps) {
  const slots = courtView === "full" ? POSITION_SLOTS_FULL : POSITION_SLOTS;
  const aspect = courtView === "full" ? "aspect-square" : "aspect-[5/7]";

  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center bg-muted/40 p-2">
      {/* Width is derived from available height so the whole court is always visible
          without scrolling. max-w-sm caps it on tall/narrow screens. */}
      <div className={cn("relative h-full max-h-full mx-auto", aspect)} style={{ maxWidth: "100%" }}>
        {courtView === "full" ? (
          <BasketballFullCourt className="absolute inset-0 w-full h-full rounded-lg" />
        ) : (
          <BasketballCourt className="absolute inset-0 w-full h-full rounded-lg" />
        )}

        {BASKETBALL_POSITIONS.map((pos) => {
          const slot = slots[pos];
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
