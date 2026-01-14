import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Check, X, ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";

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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay 
          className={cn(
            "fixed inset-0 z-[9999998] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[9999999] grid w-full max-w-[90vw] sm:max-w-sm translate-x-[-50%] translate-y-[-50%]",
            "gap-4 border bg-background p-4 sm:p-6 shadow-lg duration-200 sm:rounded-lg",
            "landscape:max-w-[400px] landscape:max-h-[85vh] landscape:overflow-y-auto landscape:p-3",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          )}
        >
          <div className="flex flex-col space-y-1.5 text-center sm:text-left landscape:pb-1">
            <DialogPrimitive.Title className="text-base landscape:text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 landscape:h-4 landscape:w-4" />
              Make This Substitution
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm landscape:text-xs text-muted-foreground">
              Follow these steps on the pitch
            </DialogPrimitive.Description>
          </div>
          
          <div className="space-y-3 landscape:space-y-2 py-3 landscape:py-1">
            {/* Step 1: Player coming off */}
            <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm landscape:text-xs">
                  Move {playerOut.name} to the bench
                </div>
                <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                  {playerOut.number && `#${playerOut.number} `}
                  {playerOut.currentPitchPosition && `leaves ${playerOut.currentPitchPosition}`}
                </div>
              </div>
              <ArrowDown className="h-4 w-4 landscape:h-3 landscape:w-3 text-destructive flex-shrink-0 mt-0.5" />
            </div>
            
            {/* Step 2: Player coming on */}
            <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm landscape:text-xs">
                  Move {playerIn.name} to {positionSwap ? positionSwap.fromPosition : (playerOut.currentPitchPosition || 'the pitch')}
                </div>
                <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                  {playerIn.number && `#${playerIn.number} `}
                  comes on from bench
                </div>
              </div>
              <ArrowUp className="h-4 w-4 landscape:h-3 landscape:w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
            </div>
            
            {/* Step 3: Position swap (if applicable) */}
            {positionSwap && (
              <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                  3
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm landscape:text-xs">
                    Move {positionSwap.player.name} to {positionSwap.toPosition}
                  </div>
                  <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                    {positionSwap.player.number && `#${positionSwap.player.number} `}
                    shifts from {positionSwap.fromPosition}
                  </div>
                </div>
                <ArrowLeftRight className="h-4 w-4 landscape:h-3 landscape:w-3 text-blue-500 flex-shrink-0 mt-0.5" />
              </div>
            )}
          </div>
          
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onCancel} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
              <X className="h-4 w-4 landscape:h-3 landscape:w-3" />
              Cancel
            </Button>
            <Button onClick={onConfirm} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
              <Check className="h-4 w-4 landscape:h-3 landscape:w-3" />
              Confirm
            </Button>
          </div>
          
          <button 
            onClick={onCancel}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
