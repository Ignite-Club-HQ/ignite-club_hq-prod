import { cn } from "@/lib/utils";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_SLOTS,
} from "./types";
import NetballCourt from "./NetballCourt";
import NetballPlayerToken from "./NetballPlayerToken";
import { findPlayerInPosition, isPositionAllowedForPlayer } from "./netballHelpers";

interface NetballCourtAreaProps {
  players: NetballPlayer[];
  selectedPlayerId: string | null;
  nextSubOutId?: string | null;
  readOnly?: boolean;
  onPlayerClick: (playerId: string) => void;
  /** Long-press a player to open the quick action sheet (score, mark injured…). */
  onPlayerLongPress?: (playerId: string) => void;
  onSlotClick: (position: NetballPosition) => void;
}

/**
 * Renders the netball court SVG with the 7 fixed position slots.
 * Each slot is either occupied (player token) or empty (drop target).
 *
 * When a player is selected (`selectedPlayerId` set), occupied slots show
 * an "ON" pulse and empty slots become bright drop targets — mirrors the
 * soccer pitch board's clarity so coaches always know the next valid action.
 */
export default function NetballCourtArea({
  players,
  selectedPlayerId,
  nextSubOutId,
  readOnly = false,
  onPlayerClick,
  onPlayerLongPress,
  onSlotClick,
}: NetballCourtAreaProps) {
  const selectedPlayer = selectedPlayerId
    ? players.find((p) => p.id === selectedPlayerId) ?? null
    : null;

  return (
    <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-pitch-green/20 p-2">
      <div className="relative w-full max-w-sm aspect-[1/2] mx-auto">
        <NetballCourt className="absolute inset-0 w-full h-full rounded-lg" />

        {NETBALL_POSITIONS.map((pos) => {
          const slot = POSITION_SLOTS[pos];
          const player = findPlayerInPosition(players, pos);
          // Position validity is informational only — final enforcement still
          // happens in the board's handleSlotClick (so "warn" mode can pass).
          const positionAllowed = selectedPlayer
            ? isPositionAllowedForPlayer(selectedPlayer, pos)
            : true;
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
                  isInvalidTarget={
                    !!selectedPlayer &&
                    selectedPlayerId !== player.id &&
                    selectedPlayer.position === null && // bench → court swap
                    !positionAllowed
                  }
                  isNextSub={nextSubOutId === player.id}
                  onClick={() => onPlayerClick(player.id)}
                  onLongPress={() => onPlayerLongPress(player.id)}
                  readOnly={readOnly}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSlotClick(pos)}
                  className={cn(
                    "w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] font-bold transition",
                    selectedPlayerId
                      ? positionAllowed
                        ? "border-emerald-400 bg-emerald-400/20 text-emerald-50 animate-pulse shadow-[0_0_8px_hsl(var(--primary)/0.4)]"
                        : "border-destructive/60 bg-destructive/10 text-destructive-foreground/80 opacity-70"
                      : "border-white/40 text-white/70 hover:border-white/80"
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
