import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, AlertCircle } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { MiniLeagueTeams, getSpecificPositionLabel } from "./types";

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
  positionLabel: string;
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

  // Find pitch players this bench player can replace directly. Position-swap
  // permutations are intentionally not listed here: they create noisy duplicate
  // rows and are handled by drag-to-swap on the pitch before making a sub.
  const options: SubOption[] = [];

  filteredPitchPlayers.forEach(pitchPlayer => {
    if (!pitchPlayer.currentPitchPosition) return;
    
    const pos = pitchPlayer.currentPitchPosition;
    if (!canPlayPosition(benchPlayer, pos)) return;
    options.push({
      pitchPlayer,
      positionLabel: getSpecificPositionLabel(pitchPlayer.position?.x, pos),
    });
  });

  const hasNoOptions = options.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Bring On {benchPlayer.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Select a player to come <span className="font-medium text-foreground">off</span> the pitch
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {directOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Direct Substitutions
              </p>
              {directOptions.map((option, idx) => {
                const pos = option.pitchPlayer.currentPitchPosition!;
                const posColors = POSITION_COLORS[pos];
                const specificPos = getSpecificPositionLabel(option.pitchPlayer.position?.x, pos);
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
                          Plays <span className={cn("font-bold", posColors.text)}>{specificPos}</span>
                          {" → "}{benchPlayer.name} takes <span className={cn("font-bold", posColors.text)}>{specificPos}</span>
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
                const specificPos = getSpecificPositionLabel(option.pitchPlayer.position?.x, pos);
                const swapPos = option.swapPlayer!.currentPitchPosition!;
                const swapPosColors = POSITION_COLORS[swapPos];
                const specificSwapPos = getSpecificPositionLabel(option.swapPlayer!.position?.x, swapPos);
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
                        <span className={cn("text-xs font-bold", posColors.text)}>{specificPos}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">Off</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                        <ArrowLeftRight className="h-3 w-3 text-amber-500" />
                        <span>
                          <span className="font-medium text-foreground">{option.swapPlayer?.name}</span>
                          {" "}
                          <span className={cn("font-bold", swapPosColors.text)}>{specificSwapPos}</span>
                          {" → "}
                          <span className={cn("font-bold", posColors.text)}>{specificPos}</span>
                          {", "}
                          {benchPlayer.name} takes{" "}
                          <span className={cn("font-bold", swapPosColors.text)}>{specificSwapPos}</span>
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

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full h-12 text-base">
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
