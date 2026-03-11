import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Check, X, ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";
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

interface PositionSwap {
  player: Player;
  fromPosition: PitchPosition;
  toPosition: PitchPosition;
}

interface ManualSubConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerOut: Player | null;
  playerIn: Player | null;
  positionSwap?: PositionSwap | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ManualSubConfirmDialog({
  open,
  onOpenChange,
  playerOut,
  playerIn,
  positionSwap,
  onConfirm,
  onCancel,
}: ManualSubConfirmDialogProps) {
  if (!playerOut || !playerIn) return null;
  
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5" />
            Make This Substitution
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Follow these steps on the pitch
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        
        <div className="space-y-3 py-2">
          {/* Step 1: Player coming off */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-sm font-bold flex-shrink-0">
              1
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Move {playerOut.name} to the bench
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {playerOut.number && `#${playerOut.number} `}
                {playerOut.currentPitchPosition && `leaves ${playerOut.currentPitchPosition}`}
              </div>
            </div>
            <ArrowDown className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          </div>
          
          {/* Step 2: Player coming on */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex-shrink-0">
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Move {playerIn.name} to {positionSwap ? positionSwap.fromPosition : (playerOut.currentPitchPosition || 'the pitch')}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {playerIn.number && `#${playerIn.number} `}
                comes on from bench
              </div>
            </div>
            <ArrowUp className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          </div>
          
          {/* Step 3: Position swap (if applicable) */}
          {positionSwap && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  Move {positionSwap.player.name} to {positionSwap.toPosition}
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {positionSwap.player.number && `#${positionSwap.player.number} `}
                  shifts from {positionSwap.fromPosition}
                </div>
              </div>
              <ArrowLeftRight className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            </div>
          )}
        </div>
        
        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1 gap-2 h-12 text-base">
            <Check className="h-4 w-4" />
            Confirm
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
