import { useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Check, X, ArrowDown, ArrowUp, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

interface SubConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  substitution: SubstitutionEvent | null;
  /** Additional subs happening at the same time (batch subs) */
  batchSubstitutions?: SubstitutionEvent[];
  onConfirm: () => void;
  onSkip: () => void;
  players: Player[];
  secondsUntilDue?: number;
}

export default function SubConfirmDialog({
  open,
  onOpenChange,
  substitution,
  batchSubstitutions = [],
  onConfirm,
  onSkip,
  players,
  secondsUntilDue = 0,
}: SubConfirmDialogProps) {
  const [countdown, setCountdown] = useState(secondsUntilDue);
  
  // Combine primary sub with batch subs
  const allSubs = substitution ? [substitution, ...batchSubstitutions] : [];
  const isBatchSub = allSubs.length > 1;
  
  // Update countdown when dialog opens or secondsUntilDue changes
  useEffect(() => {
    setCountdown(secondsUntilDue);
  }, [secondsUntilDue, open]);
  
  // Countdown timer
  useEffect(() => {
    if (!open || countdown <= 0) return;
    
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [open, countdown]);
  
  if (!substitution) return null;
  
  const isDue = countdown <= 0;
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };
  
  // Count total steps across all subs
  const getTotalSteps = () => {
    let steps = 0;
    for (const sub of allSubs) {
      steps += 2; // player out + player in
      if (sub.positionSwap) steps += 1;
    }
    return steps;
  };
  
  // Render a single substitution's steps
  const renderSubSteps = (sub: SubstitutionEvent, startStep: number, subIndex: number) => {
    const playerOut = players.find(p => p.id === sub.playerOut.id) || sub.playerOut;
    const playerIn = players.find(p => p.id === sub.playerIn.id) || sub.playerIn;
    let currentStep = startStep;
    
    return (
      <div key={sub.playerOut.id + sub.playerIn.id} className="space-y-2">
        {/* Sub header for batch subs */}
        {isBatchSub && (
          <div className="flex items-center gap-2 pt-2 first:pt-0">
            <Badge variant="outline" className="text-xs">
              Sub {subIndex + 1}
            </Badge>
          </div>
        )}
        
        {/* Step: Player coming off */}
        <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">
            {currentStep++}
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
        
        {/* Step: Player coming on */}
        <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">
            {currentStep++}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm landscape:text-xs">
              Move {playerIn.name} to {sub.positionSwap ? sub.positionSwap.fromPosition : (playerOut.currentPitchPosition || 'the pitch')}
            </div>
            <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
              {playerIn.number && `#${playerIn.number} `}
              comes on from bench
            </div>
          </div>
          <ArrowUp className="h-4 w-4 landscape:h-3 landscape:w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
        </div>
        
        {/* Step: Position swap (if applicable) */}
        {sub.positionSwap && (
          <div className="flex items-start gap-3 landscape:gap-2 p-3 landscape:p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-6 h-6 landscape:w-5 landscape:h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
              {currentStep}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm landscape:text-xs">
                Move {sub.positionSwap.player.name} to {sub.positionSwap.toPosition}
              </div>
              <div className="text-xs landscape:text-[10px] text-muted-foreground mt-0.5">
                {sub.positionSwap.player.number && `#${sub.positionSwap.player.number} `}
                shifts from {sub.positionSwap.fromPosition}
              </div>
            </div>
            <ArrowLeftRight className="h-4 w-4 landscape:h-3 landscape:w-3 text-blue-500 flex-shrink-0 mt-0.5" />
          </div>
        )}
      </div>
    );
  };
  
  // Calculate step offsets for each sub
  const getStepOffset = (subIndex: number) => {
    let offset = 1;
    for (let i = 0; i < subIndex; i++) {
      offset += 2; // player out + player in
      if (allSubs[i].positionSwap) offset += 1;
    }
    return offset;
  };
  
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay 
          className={cn(
            "fixed inset-0 z-[99998] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[99999] grid w-full max-w-[90vw] sm:max-w-sm translate-x-[-50%] translate-y-[-50%]",
            "gap-4 border bg-background p-4 sm:p-6 shadow-lg duration-200 sm:rounded-lg",
            "landscape:max-w-[400px] landscape:max-h-[85vh] landscape:overflow-y-auto landscape:p-3",
            isBatchSub && "sm:max-w-md", // Wider for batch subs
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          )}
        >
          <div className="flex flex-col space-y-1.5 text-center sm:text-left landscape:pb-1">
            <DialogPrimitive.Title className="text-base landscape:text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
              {isBatchSub ? (
                <>
                  <Users className="h-5 w-5 landscape:h-4 landscape:w-4" />
                  {isDue ? `Make ${allSubs.length} Substitutions` : `${allSubs.length} Upcoming Substitutions`}
                </>
              ) : (
                <>
                  <ArrowLeftRight className="h-5 w-5 landscape:h-4 landscape:w-4" />
                  {isDue ? "Make This Substitution" : "Upcoming Substitution"}
                </>
              )}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm landscape:text-xs text-muted-foreground">
              {isDue 
                ? `Follow these ${getTotalSteps()} steps on the pitch`
                : substitution.time === 0 && substitution.half === 2 
                  ? "Halftime substitution" 
                  : `${formatTime(substitution.time)} - ${substitution.half === 1 ? "1st" : "2nd"} Half`}
            </DialogPrimitive.Description>
          </div>
          
          {/* Countdown timer when not yet due */}
          {!isDue && (
            <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <Clock className="h-5 w-5 text-primary animate-pulse" />
              <div className="text-center">
                <div className="text-lg font-bold text-primary">
                  {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                </div>
                <div className="text-xs text-muted-foreground">until sub{isBatchSub ? 's are' : ' is'} due</div>
              </div>
            </div>
          )}
          
          {/* Scrollable area for batch subs */}
          <ScrollArea className={cn(
            "py-3 landscape:py-1",
            isBatchSub && "max-h-[40vh] landscape:max-h-[50vh]"
          )}>
            <div className="space-y-3 landscape:space-y-2 pr-2">
              {allSubs.map((sub, index) => (
                renderSubSteps(sub, getStepOffset(index), index)
              ))}
            </div>
          </ScrollArea>
          
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
              <X className="h-4 w-4 landscape:h-3 landscape:w-3" />
              Close
            </Button>
            {isDue ? (
              <>
                <Button variant="outline" onClick={onSkip} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
                  <X className="h-4 w-4 landscape:h-3 landscape:w-3" />
                  Skip
                </Button>
                <Button onClick={onConfirm} className="gap-2 h-9 landscape:h-8 text-sm landscape:text-xs">
                  <Check className="h-4 w-4 landscape:h-3 landscape:w-3" />
                  Confirm{isBatchSub ? ` All ${allSubs.length}` : ' Sub'}
                </Button>
              </>
            ) : (
              <div className="text-xs text-muted-foreground flex items-center">
                Wait for countdown to confirm
              </div>
            )}
          </div>
          
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
