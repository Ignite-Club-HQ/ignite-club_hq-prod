import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Users, ArrowDown, ArrowUp, ArrowLeftRight, Check, X } from "lucide-react";
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
  position?: PitchPosition;
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

  // Build numbered steps
  let stepNumber = 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {isTeamSizeChange ? "Team Size Change" : "Formation Change"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {hasChanges ? (
              "Follow these steps on the pitch"
            ) : isTeamSizeChange ? (
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
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {!hasChanges ? (
            <p className="text-sm text-muted-foreground">
              No player changes needed. Players will maintain their current roles.
            </p>
          ) : (
            <>
              {/* Players going to bench — red steps */}
              {playersGoingToBench.map((move) => {
                stepNumber++;
                const posColors = move.position ? POSITION_COLORS[move.position] : null;
                return (
                  <div
                    key={`bench-${move.player.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-sm font-bold flex-shrink-0">
                      {stepNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        Move {move.player.name} to the bench
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {move.player.number ? `#${move.player.number} ` : ''}
                        {posColors && `leaves ${move.position}`}
                      </div>
                    </div>
                    <ArrowDown className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  </div>
                );
              })}

              {/* Players coming on to pitch — green steps */}
              {playersGoingToPitch.map((move) => {
                stepNumber++;
                const posColors = move.position ? POSITION_COLORS[move.position] : null;
                return (
                  <div
                    key={`pitch-${move.player.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex-shrink-0">
                      {stepNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        Move {move.player.name} to {move.position || 'the pitch'}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {move.player.number ? `#${move.player.number} ` : ''}
                        comes on from bench
                      </div>
                    </div>
                    <ArrowUp className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  </div>
                );
              })}

              {/* Position swaps — blue steps */}
              {positionSwaps.map((swap) => {
                stepNumber++;
                const toColors = POSITION_COLORS[swap.toPosition];
                return (
                  <div
                    key={`swap-${swap.player.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
                      {stepNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        Move {swap.player.name} to {swap.toPosition}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {swap.player.number ? `#${swap.player.number} ` : ''}
                        shifts from {swap.fromPosition}
                      </div>
                    </div>
                    {toColors && (
                      <span className={cn("text-sm font-bold flex-shrink-0 mt-1", toColors.text)}>
                        {swap.toPosition}
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1 gap-2 h-12 text-base">
            <Check className="h-4 w-4" />
            Apply {isTeamSizeChange ? "Change" : "Formation"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
