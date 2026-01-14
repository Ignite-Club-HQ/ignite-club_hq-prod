import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeftRight, Check, AlertCircle } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  isInjured?: boolean;
}

interface SubstitutionOption {
  benchPlayer: Player;
  type: "direct" | "swap";
  swapPlayer?: Player;
  description: string;
}

interface SubstitutionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pitchPlayer: Player | null;
  benchPlayers: Player[];
  allPitchPlayers: Player[];
  onSelectOption: (benchPlayerId: string, swapPlayerId?: string) => void;
}

export default function SubstitutionPreviewDialog({
  open,
  onOpenChange,
  pitchPlayer,
  benchPlayers,
  allPitchPlayers,
  onSelectOption,
}: SubstitutionPreviewDialogProps) {
  if (!pitchPlayer?.currentPitchPosition) {
    return null;
  }

  const requiredPos = pitchPlayer.currentPitchPosition;
  const posColors = POSITION_COLORS[requiredPos];

  // Helper to check if a player can play a position
  const canPlayPosition = (player: Player, position: PitchPosition): boolean => {
    // No assigned positions means can play anywhere
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  // Calculate all possible substitution options
  const substitutionOptions: SubstitutionOption[] = [];

  // Filter out injured bench players - they cannot be subbed on
  const availableBenchPlayers = benchPlayers.filter(p => !p.isInjured);

  availableBenchPlayers.forEach(benchPlayer => {
    const canPlayDirectly = canPlayPosition(benchPlayer, requiredPos);

    if (canPlayDirectly) {
      substitutionOptions.push({
        benchPlayer,
        type: "direct",
        description: `${benchPlayer.name} takes ${requiredPos} position`,
      });
    } else {
      // Check if position swap enables this bench player
      const otherPitchPlayers = allPitchPlayers.filter(p => p.id !== pitchPlayer.id);
      
      otherPitchPlayers.forEach(swapPlayer => {
        const swapPlayerCanCoverRequired = canPlayPosition(swapPlayer, requiredPos);
        const benchCanPlaySwapPosition = swapPlayer.currentPitchPosition && 
          canPlayPosition(benchPlayer, swapPlayer.currentPitchPosition);
        
        if (
          swapPlayer.currentPitchPosition !== requiredPos &&
          swapPlayerCanCoverRequired &&
          benchCanPlaySwapPosition
        ) {
          substitutionOptions.push({
            benchPlayer,
            type: "swap",
            swapPlayer,
            description: `${swapPlayer.name} moves to ${requiredPos}, ${benchPlayer.name} takes ${swapPlayer.currentPitchPosition}`,
          });
        }
      });
    }
  });

  const directOptions = substitutionOptions.filter(o => o.type === "direct");
  const swapOptions = substitutionOptions.filter(o => o.type === "swap");

  const handleDirectSubClick = (benchPlayerId: string) => {
    onSelectOption(benchPlayerId);
  };

  const handleSwapSubClick = (benchPlayerId: string, swapPlayerId: string) => {
    onSelectOption(benchPlayerId, swapPlayerId);
  };

  const hasNoOptions = directOptions.length === 0 && swapOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col landscape:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Substitution Options
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Move <span className="font-medium text-foreground">{pitchPlayer.name}</span> (
            <span className={cn("font-bold", posColors.text)}>{requiredPos}</span>) to Bench
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Direct substitutions */}
          {directOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Direct Substitutions
              </p>
              {directOptions.map((option, idx) => (
                <Button
                  key={`direct-${idx}`}
                  variant="outline"
                  className="w-full justify-start h-auto p-3 hover:bg-muted/50"
                  onClick={() => handleDirectSubClick(option.benchPlayer.id)}
                >
                  <div className="flex items-center gap-3 w-full">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                      "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                    )}>
                      {option.benchPlayer.number || option.benchPlayer.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium truncate">{option.benchPlayer.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Takes <span className={cn("font-bold", posColors.text)}>{requiredPos}</span>
                      </p>
                    </div>
                    <Check className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Button>
              ))}
            </div>
          )}

          {/* Swap-based substitutions */}
          {swapOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                With Position Swap
              </p>
              {swapOptions.map((option, idx) => {
                const swapPosColors = option.swapPlayer?.currentPitchPosition 
                  ? POSITION_COLORS[option.swapPlayer.currentPitchPosition] 
                  : null;
                return (
                  <Button
                    key={`swap-${idx}`}
                    variant="outline"
                    className="w-full justify-start h-auto p-3 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                    onClick={() => handleSwapSubClick(option.benchPlayer.id, option.swapPlayer!.id)}
                  >
                    <div className="flex flex-col gap-1 w-full text-left">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                        )}>
                          {option.benchPlayer.number || option.benchPlayer.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium text-sm">{option.benchPlayer.name}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className={cn("text-xs font-bold", swapPosColors?.text)}>
                          {option.swapPlayer?.currentPitchPosition}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                        <ArrowLeftRight className="h-3 w-3 text-amber-500" />
                        <span>
                          <span className="font-medium text-foreground">{option.swapPlayer?.name}</span>
                          {" "}moves{" "}
                          <span className={cn("font-bold", swapPosColors?.text)}>{option.swapPlayer?.currentPitchPosition}</span>
                          {" → "}
                          <span className={cn("font-bold", posColors.text)}>{requiredPos}</span>
                        </span>
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
          )}

          {/* No options at all */}
          {hasNoOptions && (
            <div className="text-center py-6 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No substitution options available.</p>
              <p className="text-xs mt-1">
                No bench players can cover{" "}
                <span className={cn("font-bold", posColors.text)}>{requiredPos}</span>.
              </p>
              <p className="text-xs mt-1">Add players to the bench or assign positions.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
