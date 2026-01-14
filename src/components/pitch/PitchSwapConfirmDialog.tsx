import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, AlertTriangle, CheckCircle, X } from "lucide-react";
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
  
  // Check if player1 can play in pos2 position
  const player1CanPlayPos2 = !player1.assignedPositions?.length || 
    !pos2 || 
    player1.assignedPositions.includes(pos2);
  
  // Check if player2 can play in pos1 position
  const player2CanPlayPos1 = !player2.assignedPositions?.length || 
    !pos1 || 
    player2.assignedPositions.includes(pos1);
  
  const canSwap = player1CanPlayPos2 && player2CanPlayPos1;
  
  const pos1Colors = pos1 ? POSITION_COLORS[pos1] : null;
  const pos2Colors = pos2 ? POSITION_COLORS[pos2] : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay 
          className={cn(
            "fixed inset-0 z-[999998] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[999999] grid w-full max-w-[90vw] sm:max-w-md translate-x-[-50%] translate-y-[-50%]",
            "gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
            "landscape:max-w-[400px] landscape:max-h-[85vh] landscape:overflow-y-auto",
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
              Make This Position Swap
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm landscape:text-xs text-muted-foreground">
              Follow these steps on the pitch
            </DialogPrimitive.Description>
          </div>

          <div className="space-y-3 landscape:space-y-2 py-3 landscape:py-1">
            {/* Step 1: Move player 1 */}
            <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm landscape:text-xs">
                  Move {player1.name} to {pos2 || 'new position'}
                </div>
                <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                  {player1.number && `#${player1.number} `}
                  {pos1 && `moves from ${pos1}`}
                </div>
              </div>
              {pos2 && pos2Colors && (
                <span className={cn("text-xs font-bold flex-shrink-0", pos2Colors.text)}>{pos2}</span>
              )}
            </div>
            
            {/* Step 2: Move player 2 */}
            <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm landscape:text-xs">
                  Move {player2.name} to {pos1 || 'new position'}
                </div>
                <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                  {player2.number && `#${player2.number} `}
                  {pos2 && `moves from ${pos2}`}
                </div>
              </div>
              {pos1 && pos1Colors && (
                <span className={cn("text-xs font-bold flex-shrink-0", pos1Colors.text)}>{pos1}</span>
              )}
            </div>

            {/* Warning if position mismatch */}
            {!canSwap && (
              <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">Position Mismatch</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    Players may not be assigned to swapped positions.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onCancel} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
              <X className="h-4 w-4 landscape:h-3 landscape:w-3" />
              Cancel
            </Button>
            <Button onClick={onConfirm} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
              <CheckCircle className="h-4 w-4 landscape:h-3 landscape:w-3" />
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
