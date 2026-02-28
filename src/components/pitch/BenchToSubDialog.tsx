import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeftRight, Check, AlertCircle } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { MiniLeagueTeams } from "./types";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  isInjured?: boolean;
  teamSide?: "a" | "b";
}

interface SubOption {
  pitchPlayer: Player;
  type: "direct" | "swap";
  swapPlayer?: Player;
}

interface BenchToSubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchPlayer: Player | null;
  allPitchPlayers: Player[];
  onSelectOption: (pitchPlayerId: string, swapPlayerId?: string) => void;
  miniLeagueTeams?: MiniLeagueTeams;
}

export default function BenchToSubDialog({
  open,
  onOpenChange,
  benchPlayer,
  allPitchPlayers,
  onSelectOption,
  miniLeagueTeams,
}: BenchToSubDialogProps) {
  if (!benchPlayer) return null;

  const benchPlayerTeam = benchPlayer.teamSide;
  const isMiniLeague = !!miniLeagueTeams && !!benchPlayerTeam;

  const filteredPitchPlayers = isMiniLeague
    ? allPitchPlayers.filter(p => p.teamSide === benchPlayerTeam)
    : allPitchPlayers;

  const canPlayPosition = (player: Player, position: PitchPosition): boolean => {
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  // Find all pitch players this bench player can replace
  const options: SubOption[] = [];

  filteredPitchPlayers.forEach(pitchPlayer => {
    if (!pitchPlayer.currentPitchPosition) return;
    
    const pos = pitchPlayer.currentPitchPosition;
    const canDirectly = canPlayPosition(benchPlayer, pos);

    if (canDirectly) {
      options.push({ pitchPlayer, type: "direct" });
    } else {
      // Check if a swap with another pitch player enables the sub
      filteredPitchPlayers
        .filter(p => p.id !== pitchPlayer.id && p.currentPitchPosition)
        .forEach(swapPlayer => {
          const swapCanCover = canPlayPosition(swapPlayer, pos);
          const benchCanPlaySwap = canPlayPosition(benchPlayer, swapPlayer.currentPitchPosition!);
          
          if (
            swapPlayer.currentPitchPosition !== pos &&
            swapCanCover &&
            benchCanPlaySwap
          ) {
            options.push({ pitchPlayer, type: "swap", swapPlayer });
          }
        });
    }
  });

  const directOptions = options.filter(o => o.type === "direct");
  const swapOptions = options.filter(o => o.type === "swap");
  const hasNoOptions = directOptions.length === 0 && swapOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col landscape:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Bring On {benchPlayer.name}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Select a player to come <span className="font-medium text-foreground">off</span> the pitch
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {directOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Direct Substitutions
              </p>
              {directOptions.map((option, idx) => {
                const pos = option.pitchPlayer.currentPitchPosition!;
                const posColors = POSITION_COLORS[pos];
                return (
                  <Button
                    key={`direct-${idx}`}
                    variant="outline"
                    className="w-full justify-start h-auto p-3 hover:bg-muted/50"
                    onClick={() => onSelectOption(option.pitchPlayer.id)}
                  >
                    <div className="flex items-center gap-3 w-full">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                        "bg-destructive/20 text-destructive border border-destructive/30"
                      )}>
                        {option.pitchPlayer.number || option.pitchPlayer.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium truncate">{option.pitchPlayer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Plays <span className={cn("font-bold", posColors.text)}>{pos}</span>
                          {" → "}{benchPlayer.name} takes <span className={cn("font-bold", posColors.text)}>{pos}</span>
                        </p>
                      </div>
                      <Check className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Button>
                );
              })}
            </div>
          )}

          {swapOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                With Position Swap
              </p>
              {swapOptions.map((option, idx) => {
                const pos = option.pitchPlayer.currentPitchPosition!;
                const posColors = POSITION_COLORS[pos];
                const swapPos = option.swapPlayer!.currentPitchPosition!;
                const swapPosColors = POSITION_COLORS[swapPos];
                return (
                  <Button
                    key={`swap-${idx}`}
                    variant="outline"
                    className="w-full justify-start h-auto p-3 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                    onClick={() => onSelectOption(option.pitchPlayer.id, option.swapPlayer!.id)}
                  >
                    <div className="flex flex-col gap-1 w-full text-left">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                        )}>
                          {option.pitchPlayer.number || option.pitchPlayer.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium text-sm">{option.pitchPlayer.name}</span>
                        <span className={cn("text-xs font-bold", posColors.text)}>{pos}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">Off</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                        <ArrowLeftRight className="h-3 w-3 text-amber-500" />
                        <span>
                          <span className="font-medium text-foreground">{option.swapPlayer?.name}</span>
                          {" "}
                          <span className={cn("font-bold", swapPosColors.text)}>{swapPos}</span>
                          {" → "}
                          <span className={cn("font-bold", posColors.text)}>{pos}</span>
                          {", "}
                          {benchPlayer.name} takes{" "}
                          <span className={cn("font-bold", swapPosColors.text)}>{swapPos}</span>
                        </span>
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
          )}

          {hasNoOptions && (
            <div className="text-center py-6 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No substitution options available.</p>
              <p className="text-xs mt-1">
                {benchPlayer.name} cannot cover any current pitch positions.
              </p>
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
