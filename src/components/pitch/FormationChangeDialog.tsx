import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowRight, Users } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { Player } from "./types";

interface PositionSwap {
  player: Player;
  fromPosition: PitchPosition;
  toPosition: PitchPosition;
}

interface FormationChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFormation: string;
  newFormation: string;
  positionSwaps: PositionSwap[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FormationChangeDialog({
  open,
  onOpenChange,
  currentFormation,
  newFormation,
  positionSwaps,
  onConfirm,
  onCancel,
}: FormationChangeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md landscape:max-w-lg landscape:max-h-[85vh] landscape:overflow-y-auto landscape:p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Formation Change
          </DialogTitle>
          <DialogDescription>
            Change from <span className="font-semibold text-foreground">{currentFormation}</span> to{" "}
            <span className="font-semibold text-foreground">{newFormation}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {positionSwaps.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                The following players will move to new positions:
              </p>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {positionSwaps.map((swap) => {
                  const fromColors = POSITION_COLORS[swap.fromPosition];
                  const toColors = POSITION_COLORS[swap.toPosition];
                  return (
                    <div
                      key={swap.player.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                          {swap.player.number || swap.player.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium">{swap.player.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={cn("font-bold", fromColors.text)}>
                          {swap.fromPosition}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span className={cn("font-bold", toColors.text)}>
                          {swap.toPosition}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No position changes needed. Players will maintain their current roles.
            </p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1">
            Apply Formation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
