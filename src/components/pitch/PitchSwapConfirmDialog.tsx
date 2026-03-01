import { Button } from "@/components/ui/button";
import { ArrowLeftRight, AlertTriangle, CheckCircle, X } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
}

interface PitchSwapConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player1: Player | null;
  player2: Player | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PitchSwapConfirmDialog({
  open,
  onOpenChange,
  player1,
  player2,
  onConfirm,
  onCancel,
}: PitchSwapConfirmDialogProps) {
  if (!player1 || !player2) return null;

  const pos1 = player1.currentPitchPosition;
  const pos2 = player2.currentPitchPosition;
  
  const player1CanPlayPos2 = !player1.assignedPositions?.length || 
    !pos2 || 
    player1.assignedPositions.includes(pos2);
  
  const player2CanPlayPos1 = !player2.assignedPositions?.length || 
    !pos1 || 
    player2.assignedPositions.includes(pos1);
  
  const canSwap = player1CanPlayPos2 && player2CanPlayPos1;
  
  const pos1Colors = pos1 ? POSITION_COLORS[pos1] : null;
  const pos2Colors = pos2 ? POSITION_COLORS[pos2] : null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5" />
            Make This Position Swap
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Follow these steps on the pitch
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-3 py-2">
          {/* Step 1: Move player 1 */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
              1
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Move {player1.name} to {pos2 || 'new position'}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {player1.number && `#${player1.number} `}
                {pos1 && `moves from ${pos1}`}
              </div>
            </div>
            {pos2 && pos2Colors && (
              <span className={cn("text-sm font-bold flex-shrink-0", pos2Colors.text)}>{pos2}</span>
            )}
          </div>
          
          {/* Step 2: Move player 2 */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Move {player2.name} to {pos1 || 'new position'}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {player2.number && `#${player2.number} `}
                {pos2 && `moves from ${pos2}`}
              </div>
            </div>
            {pos1 && pos1Colors && (
              <span className={cn("text-sm font-bold flex-shrink-0", pos1Colors.text)}>{pos1}</span>
            )}
          </div>

          {/* Warning if position mismatch */}
          {!canSwap && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
              <div>
                <p className="font-medium text-yellow-600 dark:text-yellow-400 text-sm">Position Mismatch</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Players may not be assigned to swapped positions.
                </p>
              </div>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1 gap-2 h-12 text-base">
            <CheckCircle className="h-4 w-4" />
            Confirm
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
