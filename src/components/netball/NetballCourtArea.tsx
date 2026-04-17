import { cn } from "@/lib/utils";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_SLOTS,
} from "./types";
import NetballCourt from "./NetballCourt";
import NetballPlayerToken from "./NetballPlayerToken";
import { findPlayerInPosition } from "./netballHelpers";

interface NetballCourtAreaProps {
  players: NetballPlayer[];
  selectedPlayerId: string | null;
  nextSubOutId?: string | null;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  onSlotClick: (position: NetballPosition) => void;
}

/**
 * Renders the netball court SVG with the 7 fixed position slots.
 * Each slot is either occupied (player token) or empty (drop target).
 */
export default function NetballCourtArea({
  players,
  selectedPlayerId,
  nextSubOutId,
  readOnly = false,
  onPlayerClick,
  onSlotClick,
}: NetballCourtAreaProps) {
  return (
    <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-pitch-green/20 p-2">
      <div className="relative w-full max-w-sm aspect-[1/2] mx-auto">
        <NetballCourt className="absolute inset-0 w-full h-full rounded-lg" />

        {NETBALL_POSITIONS.map((pos) => {
          const slot = POSITION_SLOTS[pos];
          const player = findPlayerInPosition(players, pos);
          return (
            <div
              key={pos}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              {player ? (
                <NetballPlayerToken
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
