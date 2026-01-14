import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeftRight } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
}

interface PositionSwapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchPlayer: Player | null;
  pitchPlayers: Player[];
  requiredPosition: PitchPosition | null;
  onSwapAndSubstitute: (pitchPlayerId: string, swapWithId: string) => void;
  onCancel: () => void;
}

export default function PositionSwapDialog({
  open,
  onOpenChange,
  benchPlayer,
  pitchPlayers,
  requiredPosition,
  onSwapAndSubstitute,
  onCancel,
}: PositionSwapDialogProps) {
  // Find a player currently in the required position (this is the player being subbed off)
  const playerInPosition = pitchPlayers.find(p => p.currentPitchPosition === requiredPosition);

  // Helper to check if a player can play a position
  const canPlayPosition = (player: Player | null, position: PitchPosition): boolean => {
    if (!player) return false;
    // No assigned positions means can play anywhere
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  // Find players who can swap to the required position AND whose position the bench player can take
  const playersWhoCanSwap = pitchPlayers.filter(p => {
    // Can't swap with the player being subbed off (the one in the required position)
    if (p.id === playerInPosition?.id) return false;
    // Swap player must be able to play the required position
    if (!canPlayPosition(p, requiredPosition!)) return false;
    // Bench player must be able to play the swap player's current position
    if (p.currentPitchPosition && !canPlayPosition(benchPlayer, p.currentPitchPosition)) return false;
    return true;
  });

  if (!benchPlayer || !requiredPosition) return null;

  const positionColors = POSITION_COLORS[requiredPosition];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md landscape:max-w-lg landscape:max-h-[85vh] landscape:overflow-y-auto landscape:p-4">
        <DialogHeader>
          <DialogTitle>Position Swap Needed</DialogTitle>
          <DialogDescription>
            Move {benchPlayer.name} from Bench to{" "}
            <span className={cn("font-bold", positionColors.text)}>{requiredPosition}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {playersWhoCanSwap.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                First, move{" "}
                <span className="font-medium text-foreground">{playerInPosition?.name}</span> from{" "}
                <span className={cn("font-bold", positionColors.text)}>{requiredPosition}</span> to another position:
              </p>
              <div className="space-y-2">
                {playersWhoCanSwap.map(player => {
                  const currentColors = POSITION_COLORS[player.currentPitchPosition!];
                  return (
                    <button
                      key={player.id}
                      onClick={() => onSwapAndSubstitute(playerInPosition!.id, player.id)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                          {player.number || player.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="text-left">
                          <div className="font-medium">
                            Move {player.name} from {player.currentPitchPosition} to {requiredPosition}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Then {playerInPosition?.name} → Bench, {benchPlayer.name} → {player.currentPitchPosition}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No players on the pitch can swap to the {requiredPosition} position. 
              Assign more position options to your players.
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
