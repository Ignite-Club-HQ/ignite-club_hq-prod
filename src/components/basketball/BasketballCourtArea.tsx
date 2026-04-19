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
  /** True when the selected player is on the bench — court tokens become swap targets. */
  selectedIsOnBench?: boolean;
  nextSubOutId?: string | null;
  /** Coach-assistant: most over-played on-court player (subtle "should rest" outline). */
  overplayedOnCourtId?: string | null;
  recentlySwappedIds?: string[];
  readOnly?: boolean;
  courtView?: BasketballCourtView;
  /** When true, empty position slots render nothing (used in live mode after tip-off). */
  hideEmptySlots?: boolean;
  onPlayerClick: (playerId: string) => void;
  onPlayerLongPress?: (playerId: string) => void;
  onSlotClick: (position: BasketballPosition) => void;
}

/**
 * Renders the court SVG with 5 soft position slots. Slots are visual hints
 * only — any player can occupy any slot.
 *
 * When `selectedIsOnBench` is true, court players that aren't the selected
 * one are presented as swap targets. When the selected player is on court,
 * the other court tokens are dimmed so the coach's eye is drawn to the bench.
 */
export default function BasketballCourtArea({
  players,
  selectedPlayerId,
  selectedIsOnBench = false,
  nextSubOutId,
  overplayedOnCourtId = null,
  recentlySwappedIds = [],
  readOnly = false,
  courtView = "half",
  hideEmptySlots = false,
  onPlayerClick,
  onPlayerLongPress,
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
                  // Court tokens are swap targets in TWO scenarios:
                  //  1. Selected player is on the bench → substitution
                  //  2. Selected player is on the court → position swap
                  isSwapTarget={
                    !!selectedPlayerId &&
                    selectedPlayerId !== player.id
                  }
                  // No more dimming during court-swap mode — every court player
                  // is a valid target, so they should all glow, not fade.
                  isDimmed={false}
                  isRecentlySwapped={recentlySwappedIds.includes(player.id)}
                  isNextSub={nextSubOutId === player.id}
                  isOverplayed={overplayedOnCourtId === player.id}
                  onClick={() => onPlayerClick(player.id)}
                  onLongPress={onPlayerLongPress ? () => onPlayerLongPress(player.id) : undefined}
                  readOnly={readOnly}
                />
              ) : hideEmptySlots ? null : (
                <button
                  type="button"
                  onClick={() => onSlotClick(pos)}
                  className={cn(
                    "w-12 h-12 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center text-[10px] font-bold text-white/70 hover:border-white/80 transition",
                    selectedPlayerId && "border-emerald-400 bg-emerald-400/15 text-emerald-50 animate-pulse"
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
