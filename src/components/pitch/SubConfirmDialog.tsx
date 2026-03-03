import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Check, X, ArrowDown, ArrowUp, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  skipped?: boolean;
}

interface SubConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  substitution: SubstitutionEvent | null;
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
  
  const allSubs = substitution ? [substitution, ...batchSubstitutions] : [];
  const isBatchSub = allSubs.length > 1;
  const alreadyExecuted = substitution?.executed === true && !substitution?.skipped;
  const wasSkipped = substitution?.skipped === true;
  
  useEffect(() => {
    setCountdown(secondsUntilDue);
  }, [secondsUntilDue, open]);
  
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
  
  const getTotalSteps = () => {
    let steps = 0;
    for (const sub of allSubs) {
      steps += 2;
      if (sub.positionSwap) steps += 1;
    }
    return steps;
  };
  
  const renderSubSteps = (sub: SubstitutionEvent, startStep: number, subIndex: number) => {
    const playerOut = players.find(p => p.id === sub.playerOut.id) || sub.playerOut;
    const playerIn = players.find(p => p.id === sub.playerIn.id) || sub.playerIn;
    let currentStep = startStep;
    
    return (
      <div key={sub.playerOut.id + sub.playerIn.id} className="space-y-2">
        {isBatchSub && (
          <div className="flex items-center gap-2 pt-2 first:pt-0">
            <Badge variant="outline" className="text-xs">
              Sub {subIndex + 1}
            </Badge>
          </div>
        )}
        
        {/* Step: Player coming off */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-sm font-bold flex-shrink-0">
            {currentStep++}
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
        
        {/* Step: Player coming on */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex-shrink-0">
            {currentStep++}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">
              Move {playerIn.name} to {sub.positionSwap ? sub.positionSwap.fromPosition : (playerOut.currentPitchPosition || 'the pitch')}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {playerIn.number && `#${playerIn.number} `}
              comes on from bench
            </div>
          </div>
          <ArrowUp className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
        </div>
        
        {/* Step: Position swap */}
        {sub.positionSwap && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
              {currentStep}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Move {sub.positionSwap.player.name} to {sub.positionSwap.toPosition}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {sub.positionSwap.player.number && `#${sub.positionSwap.player.number} `}
                shifts from {sub.positionSwap.fromPosition}
              </div>
            </div>
            <ArrowLeftRight className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
          </div>
        )}
      </div>
    );
  };
  
  const getStepOffset = (subIndex: number) => {
    let offset = 1;
    for (let i = 0; i < subIndex; i++) {
      offset += 2;
      if (allSubs[i].positionSwap) offset += 1;
    }
    return offset;
  };
  
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className={cn("sm:max-w-sm", isBatchSub && "sm:max-w-md")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            {wasSkipped ? (
              <>
                <X className="h-5 w-5 text-muted-foreground" />
                Substitution Was Skipped
              </>
            ) : alreadyExecuted ? (
              <>
                <Check className="h-5 w-5 text-muted-foreground" />
                Substitution Already Made
              </>
            ) : isBatchSub ? (
              <>
                <Users className="h-5 w-5" />
                {isDue ? `Make ${allSubs.length} Substitutions` : `${allSubs.length} Upcoming Substitutions`}
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-5 w-5" />
                {isDue ? "Make This Substitution" : "Upcoming Substitution"}
              </>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {wasSkipped
              ? "This substitution was skipped and not made"
              : alreadyExecuted
              ? "This substitution has already been completed"
              : isDue 
                ? `Follow these ${getTotalSteps()} steps on the pitch`
                : substitution.time === 0 && substitution.half === 2 
                  ? "Halftime substitution" 
                  : `${formatTime(substitution.time)} - ${substitution.half === 1 ? "1st" : "2nd"} Half`}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        
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
        
        {/* Scrollable area for sub steps */}
        <div className="overflow-y-auto overscroll-contain py-2" style={{ maxHeight: '50vh' }}>
          <div className="space-y-3 pr-1">
            {allSubs.map((sub, index) => (
              renderSubSteps(sub, getStepOffset(index), index)
            ))}
          </div>
        </div>
        
        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Close
          </Button>
          {isDue && !wasSkipped && (
            <>
              <Button variant="outline" onClick={onSkip} disabled={alreadyExecuted} className="gap-2 h-12 text-base">
                <X className="h-4 w-4" />
                Skip
              </Button>
              <Button onClick={onConfirm} disabled={alreadyExecuted} className="flex-1 gap-2 h-12 text-base">
                <Check className="h-4 w-4" />
                {alreadyExecuted ? 'Done' : `Confirm${isBatchSub ? ` All` : ''}`}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
