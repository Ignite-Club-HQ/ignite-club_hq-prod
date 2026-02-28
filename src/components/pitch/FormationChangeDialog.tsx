import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowRight, Users, LogIn, LogOut } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { Player } from "./types";

interface PositionSwap {
  player: Player;
  fromPosition: PitchPosition;
  toPosition: PitchPosition;
}

interface BenchMove {
  player: Player;
  direction: "to-pitch" | "to-bench";
  position?: PitchPosition; // Position they're going to (if to-pitch) or coming from (if to-bench)
}

interface FormationChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFormation: string;
  newFormation: string;
  positionSwaps: PositionSwap[];
  benchMoves?: BenchMove[];
  onConfirm: () => void;
  onCancel: () => void;
  isTeamSizeChange?: boolean;
  currentTeamSize?: string;
  newTeamSize?: string;
}

export default function FormationChangeDialog({
  open,
  onOpenChange,
  currentFormation,
  newFormation,
  positionSwaps,
  benchMoves = [],
  onConfirm,
  onCancel,
  isTeamSizeChange,
  currentTeamSize,
  newTeamSize,
}: FormationChangeDialogProps) {
  const playersGoingToPitch = benchMoves.filter(m => m.direction === "to-pitch");
  const playersGoingToBench = benchMoves.filter(m => m.direction === "to-bench");
  const hasChanges = positionSwaps.length > 0 || benchMoves.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md landscape:max-w-lg landscape:max-h-[85vh] landscape:overflow-y-auto landscape:p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {isTeamSizeChange ? "Team Size Change" : "Formation Change"}
          </DialogTitle>
          <DialogDescription>
            {isTeamSizeChange ? (
              <>
                Change from <span className="font-semibold text-foreground">{currentTeamSize} players</span> ({currentFormation}) to{" "}
                <span className="font-semibold text-foreground">{newTeamSize} players</span> ({newFormation})
              </>
            ) : (
              <>
                Change from <span className="font-semibold text-foreground">{currentFormation}</span> to{" "}
                <span className="font-semibold text-foreground">{newFormation}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {!hasChanges ? (
            <p className="text-sm text-muted-foreground">
              No player changes needed. Players will maintain their current roles.
            </p>
          ) : (
            <>
              {/* Players going to bench */}
              {playersGoingToBench.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <LogOut className="h-3.5 w-3.5" />
                    Going to Bench
                  </p>
                  <div className="space-y-1.5">
                    {playersGoingToBench.map((move) => {
                      const posColors = move.position ? POSITION_COLORS[move.position] : null;
                      return (
                        <div
                          key={move.player.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-destructive/5"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-destructive/20 flex items-center justify-center text-xs font-bold text-destructive">
                              {move.player.number || move.player.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{move.player.name}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            {posColors && (
                              <span className={cn("font-bold", posColors.text)}>
                                {move.position}
                              </span>
                            )}
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground font-medium">Bench</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Players coming on to pitch */}
              {playersGoingToPitch.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <LogIn className="h-3.5 w-3.5" />
                    Coming on to Pitch
                  </p>
                  <div className="space-y-1.5">
                    {playersGoingToPitch.map((move) => {
                      const posColors = move.position ? POSITION_COLORS[move.position] : null;
                      return (
                        <div
                          key={move.player.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-primary/5"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {move.player.number || move.player.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{move.player.name}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground font-medium">Bench</span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            {posColors && (
                              <span className={cn("font-bold", posColors.text)}>
                                {move.position}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Position swaps */}
              {positionSwaps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5" />
                    Position Changes
                  </p>
                  <div className="space-y-1.5 max-h-[150px] overflow-y-auto">
                    {positionSwaps.map((swap) => {
                      const fromColors = POSITION_COLORS[swap.fromPosition];
                      const toColors = POSITION_COLORS[swap.toPosition];
                      return (
                        <div
                          key={swap.player.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/50"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {swap.player.number || swap.player.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{swap.player.name}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={cn("font-bold", fromColors.text)}>
                              {swap.fromPosition}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className={cn("font-bold", toColors.text)}>
                              {swap.toPosition}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1">
            Apply {isTeamSizeChange ? "Change" : "Formation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
