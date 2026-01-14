import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserRoundCheck, ArrowRightLeft, ChevronRight, X, Clock, ArrowDown, ArrowUp, SkipForward, Pencil } from "lucide-react";
import { PitchPosition } from "./PositionBadge";
import { toast } from "@/hooks/use-toast";

const TIMER_STATE_KEY = "pitch-board-timer-state";
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const SNOOZE_KEY = "ignite-pending-sub-snoozed";
const SNOOZE_DURATION_MS = 60000; // 1 minute snooze

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
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

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
}

interface PitchBoardState {
  teamId: string;
  players: Player[];
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
}

interface PendingSubWidgetProps {
  onAcceptSub: () => void;
}

interface SubInfo {
  sub: SubstitutionEvent;
  isDue: boolean;
  secondsUntil: number;
}

export default function PendingSubWidget({ onAcceptSub }: PendingSubWidgetProps) {
  const [subInfo, setSubInfo] = useState<SubInfo | null>(null);
  const [teamName, setTeamName] = useState<string>("");
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [hasAutoSubPlan, setHasAutoSubPlan] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [editedPlayerOutId, setEditedPlayerOutId] = useState<string | null>(null);
  const [editedPlayerInId, setEditedPlayerInId] = useState<string | null>(null);

  // Get players on pitch and bench (exclude injured from bench options)
  const playersOnPitch = useMemo(() => allPlayers.filter(p => p.position !== null), [allPlayers]);
  const playersOnBench = useMemo(() => allPlayers.filter(p => p.position === null), [allPlayers]);
  const availableBenchPlayers = useMemo(() => allPlayers.filter(p => p.position === null && !p.isInjured), [allPlayers]);

  // Get the actual players to use (edited or original)
  const actualPlayerOut = useMemo(() => {
    if (editedPlayerOutId) {
      return allPlayers.find(p => p.id === editedPlayerOutId) || subInfo?.sub.playerOut;
    }
    return subInfo?.sub.playerOut;
  }, [editedPlayerOutId, allPlayers, subInfo]);

  const actualPlayerIn = useMemo(() => {
    if (editedPlayerInId) {
      return allPlayers.find(p => p.id === editedPlayerInId) || subInfo?.sub.playerIn;
    }
    return subInfo?.sub.playerIn;
  }, [editedPlayerInId, allPlayers, subInfo]);

  const checkSnoozeStatus = useCallback(() => {
    try {
      const snoozedUntil = localStorage.getItem(SNOOZE_KEY);
      if (snoozedUntil) {
        const snoozeEnd = parseInt(snoozedUntil, 10);
        if (Date.now() < snoozeEnd) {
          setIsSnoozed(true);
          return true;
        } else {
          localStorage.removeItem(SNOOZE_KEY);
          setIsSnoozed(false);
        }
      }
    } catch {
      // Ignore
    }
    return false;
  }, []);

  const handleSnooze = (e: React.MouseEvent) => {
    e.stopPropagation();
    const snoozeUntil = Date.now() + SNOOZE_DURATION_MS;
    localStorage.setItem(SNOOZE_KEY, snoozeUntil.toString());
    setIsSnoozed(true);
    
    // Auto-unsnooze after duration
    setTimeout(() => {
      localStorage.removeItem(SNOOZE_KEY);
      setIsSnoozed(false);
    }, SNOOZE_DURATION_MS);
  };

  const checkForPendingSub = useCallback(() => {
    if (checkSnoozeStatus()) return;

    try {
      const pitchStateRaw = localStorage.getItem(PITCH_STATE_KEY);
      const timerStateRaw = localStorage.getItem(TIMER_STATE_KEY);

      // No game in progress if no timer state or timer is not running
      if (!timerStateRaw) {
        setSubInfo(null);
        setHasAutoSubPlan(false);
        return;
      }

      const timerState: TimerState = JSON.parse(timerStateRaw);
      
      // CRITICAL: Only show pending subs when game timer is actually running
      if (!timerState.isRunning) {
        setSubInfo(null);
        setHasAutoSubPlan(false);
        return;
      }

      if (!pitchStateRaw) {
        setSubInfo(null);
        setHasAutoSubPlan(false);
        return;
      }

      const pitchState: PitchBoardState = JSON.parse(pitchStateRaw);
      
      // Store all players for editing subs
      setAllPlayers(pitchState.players || []);

      // Check if there's an active auto sub plan
      const unexecutedSubs = pitchState.autoSubPlan?.filter(sub => !sub.executed) || [];
      const hasActivePlan = pitchState.autoSubActive && unexecutedSubs.length > 0;
      setHasAutoSubPlan(hasActivePlan);

      if (!hasActivePlan) {
        setSubInfo(null);
        return;
      }

      // Sort subs by half then time
      const sortedSubs = [...unexecutedSubs].sort((a, b) => {
        if (a.half !== b.half) return a.half - b.half;
        return a.time - b.time;
      });
      setTeamName(timerState.teamName || "");
      const minutesPerHalf = timerState.minutesPerHalf || 20;
      const currentHalf = timerState.currentHalf || 1;

      // Calculate current elapsed time in seconds
      let currentElapsedSeconds = timerState.elapsedSeconds || 0;
      if (timerState.isRunning && timerState.lastUpdateTime) {
        const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
        currentElapsedSeconds = Math.min(currentElapsedSeconds + secondsPassed, minutesPerHalf * 60);
      }

      // Calculate total game seconds (for comparing across halves)
      const currentTotalSeconds = currentHalf === 1 
        ? currentElapsedSeconds 
        : (minutesPerHalf * 60) + currentElapsedSeconds;

      // Find the best sub to show
      let bestSub: SubstitutionEvent | null = null;
      let isDue = false;
      let secondsUntil = 0;

      for (const sub of sortedSubs) {
        // sub.time is already in seconds
        const subTotalSeconds = sub.half === 1 
          ? sub.time 
          : (minutesPerHalf * 60) + sub.time;
        
        if (subTotalSeconds <= currentTotalSeconds) {
          // This sub is due NOW
          bestSub = sub;
          isDue = true;
          secondsUntil = 0;
          break; // Due subs take priority
        } else if (!bestSub) {
          // First upcoming sub
          bestSub = sub;
          isDue = false;
          secondsUntil = subTotalSeconds - currentTotalSeconds;
        }
      }

      if (bestSub) {
        console.log("[PendingSubWidget] Found sub:", { 
          subTime: bestSub.time, 
          currentTotalSeconds, 
          isDue, 
          secondsUntil 
        });
        setSubInfo({ sub: bestSub, isDue, secondsUntil });
      } else {
        setSubInfo(null);
      }
    } catch (e) {
      console.error("[PendingSubWidget] Error:", e);
      setSubInfo(null);
      setHasAutoSubPlan(false);
    }
  }, [checkSnoozeStatus]);

  useEffect(() => {
    checkForPendingSub();
    const interval = setInterval(checkForPendingSub, 2000);
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TIMER_STATE_KEY || e.key === PITCH_STATE_KEY || e.key === SNOOZE_KEY) {
        checkForPendingSub();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkForPendingSub]);

  if (!subInfo || isSnoozed) return null;

  const { sub, isDue, secondsUntil } = subInfo;

  // Format countdown display
  const formatCountdown = () => {
    if (isDue) return "Sub Required";
    const mins = Math.floor(secondsUntil / 60);
    const secs = secondsUntil % 60;
    if (mins > 0) {
      return `Sub in ${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return `Sub in ${secs}s`;
  };

  const handleAcceptClick = () => {
    // Reset edited players to original
    setEditedPlayerOutId(null);
    setEditedPlayerInId(null);
    // Always show confirmation dialog - whether due or upcoming
    setShowConfirmDialog(true);
  };

  const executeSubstitution = () => {
    try {
      const pitchStateRaw = localStorage.getItem(PITCH_STATE_KEY);
      const timerStateRaw = localStorage.getItem(TIMER_STATE_KEY);
      
      if (pitchStateRaw) {
        const pitchState: PitchBoardState = JSON.parse(pitchStateRaw);
        
        // Get current time info for regenerating plan
        let currentElapsedSeconds = 0;
        let currentHalf: 1 | 2 = 1;
        let minutesPerHalf = 20;
        
        if (timerStateRaw) {
          const timerState: TimerState = JSON.parse(timerStateRaw);
          minutesPerHalf = timerState.minutesPerHalf || 20;
          currentHalf = timerState.currentHalf || 1;
          currentElapsedSeconds = timerState.elapsedSeconds || 0;
          
          if (timerState.isRunning && timerState.lastUpdateTime) {
            const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
            currentElapsedSeconds = Math.min(currentElapsedSeconds + secondsPassed, minutesPerHalf * 60);
          }
        }
        
        // Use edited players if set, otherwise use original sub players
        const playerOut = actualPlayerOut || sub.playerOut;
        const playerIn = actualPlayerIn || sub.playerIn;
        
        // Find current state of players to validate swap
        const currentPlayerOut = pitchState.players.find(p => p.id === playerOut.id);
        const currentPlayerIn = pitchState.players.find(p => p.id === playerIn.id);
        
        // CRITICAL: Validate both players are in correct positions before executing
        // playerOut must exist and be on pitch (has position)
        // playerIn must exist and be on bench (no position)
        if (!currentPlayerOut?.position || !currentPlayerIn || currentPlayerIn.position !== null) {
          console.log('[PendingSubWidget] Invalid sub state, skipping without player changes:', {
            playerOut: playerOut.name,
            playerOutOnPitch: !!currentPlayerOut?.position,
            playerIn: playerIn.name,
            playerInOnBench: currentPlayerIn?.position === null
          });
          
          // Mark sub as executed but DON'T change any player positions
          const updatedPlan = pitchState.autoSubPlan.map(s => {
            if (s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half) {
              return { ...s, executed: true };
            }
            return s;
          });
          
          const updatedState = { ...pitchState, autoSubPlan: updatedPlan };
          localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(updatedState));
          window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
          
          toast({
            title: "Substitution skipped",
            description: "Players are not in expected positions",
          });
          
          setShowConfirmDialog(false);
          checkForPendingSub();
          return;
        }
        
        // Both players validated - execute the swap safely
        const pitchPosition = { ...currentPlayerOut.position };
        const pitchPositionType = currentPlayerOut.currentPitchPosition;
        
        // Swap the players' positions
        const updatedPlayers = pitchState.players.map(p => {
          if (p.id === playerOut.id) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === playerIn.id) {
            return { 
              ...p, 
              position: pitchPosition,
              currentPitchPosition: pitchPositionType
            };
          }
          return p;
        });
        
        // Calculate the scheduled time for this sub
        const subTotalSeconds = sub.half === 1 ? sub.time : (minutesPerHalf * 60) + sub.time;
        const currentTotalSeconds = currentHalf === 1 ? currentElapsedSeconds : (minutesPerHalf * 60) + currentElapsedSeconds;
        const delaySeconds = Math.max(0, currentTotalSeconds - subTotalSeconds);
        
        // Mark current sub as executed and adjust future subs if late
        let updatedPlan = pitchState.autoSubPlan.map(s => {
          if (s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half) {
            return { ...s, executed: true };
          }
          return s;
        });
        
        // If sub was made late (more than 30 seconds), regenerate remaining subs
        if (delaySeconds > 30) {
          console.log(`[PendingSubWidget] Sub was ${Math.round(delaySeconds / 60)}m late, regenerating remaining plan`);
          
          // Get remaining unexecuted subs
          const remainingSubs = updatedPlan.filter(s => !s.executed);
          
          if (remainingSubs.length > 0) {
            // Calculate time remaining in game
            const totalGameSeconds = minutesPerHalf * 2 * 60;
            const remainingGameSeconds = totalGameSeconds - currentTotalSeconds;
            
            // Redistribute remaining subs evenly across remaining time
            const numRemainingSubs = remainingSubs.length;
            const intervalBetweenSubs = Math.floor(remainingGameSeconds / (numRemainingSubs + 1));
            
            // Minimum interval of 60 seconds
            const minInterval = 60;
            const actualInterval = Math.max(intervalBetweenSubs, minInterval);
            
            let nextSubTime = currentTotalSeconds + actualInterval;
            
            // Update the times for remaining subs
            updatedPlan = updatedPlan.map(s => {
              if (s.executed) return s;
              
              // Calculate new half and time for this sub
              const halfDurationSeconds = minutesPerHalf * 60;
              const newHalf: 1 | 2 = nextSubTime < halfDurationSeconds ? 1 : 2;
              const newTime = newHalf === 1 ? nextSubTime : nextSubTime - halfDurationSeconds;
              
              nextSubTime += actualInterval;
              
              return { ...s, half: newHalf, time: Math.floor(newTime) };
            });
            
            console.log(`[PendingSubWidget] Redistributed ${numRemainingSubs} remaining subs with ${Math.round(actualInterval / 60)}m intervals`);
          }
        }
        
        const updatedState = { ...pitchState, autoSubPlan: updatedPlan, players: updatedPlayers };
        localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(updatedState));
        
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
        
        toast({
          title: "Substitution made",
          description: `${playerIn.name} on for ${playerOut.name}`,
        });
        
        checkForPendingSub();
      }
    } catch (e) {
      console.error("[PendingSubWidget] Error executing sub:", e);
      toast({
        title: "Error",
        description: "Failed to execute substitution",
        variant: "destructive",
      });
    }
    setShowConfirmDialog(false);
  };

  const skipSubstitution = () => {
    try {
      const pitchStateRaw = localStorage.getItem(PITCH_STATE_KEY);
      const timerStateRaw = localStorage.getItem(TIMER_STATE_KEY);
      
      if (pitchStateRaw) {
        const pitchState: PitchBoardState = JSON.parse(pitchStateRaw);
        
        // Get current time info
        let currentElapsedSeconds = 0;
        let currentHalf: 1 | 2 = 1;
        let minutesPerHalf = 20;
        
        if (timerStateRaw) {
          const timerState: TimerState = JSON.parse(timerStateRaw);
          minutesPerHalf = timerState.minutesPerHalf || 20;
          currentHalf = timerState.currentHalf || 1;
          currentElapsedSeconds = timerState.elapsedSeconds || 0;
          
          if (timerState.isRunning && timerState.lastUpdateTime) {
            const secondsPassed = Math.floor((Date.now() - timerState.lastUpdateTime) / 1000);
            currentElapsedSeconds = Math.min(currentElapsedSeconds + secondsPassed, minutesPerHalf * 60);
          }
        }
        
        const currentTotalSeconds = currentHalf === 1 ? currentElapsedSeconds : (minutesPerHalf * 60) + currentElapsedSeconds;
        
        // Mark current sub as executed (skipped)
        let updatedPlan = pitchState.autoSubPlan.map(s => {
          if (s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half) {
            return { ...s, executed: true };
          }
          return s;
        });
        
        // Regenerate remaining subs
        const remainingSubs = updatedPlan.filter(s => !s.executed);
        
        if (remainingSubs.length > 0) {
          const totalGameSeconds = minutesPerHalf * 2 * 60;
          const remainingGameSeconds = totalGameSeconds - currentTotalSeconds;
          const numRemainingSubs = remainingSubs.length;
          const intervalBetweenSubs = Math.floor(remainingGameSeconds / (numRemainingSubs + 1));
          const actualInterval = Math.max(intervalBetweenSubs, 60);
          
          let nextSubTime = currentTotalSeconds + actualInterval;
          
          updatedPlan = updatedPlan.map(s => {
            if (s.executed) return s;
            
            const halfDurationSeconds = minutesPerHalf * 60;
            const newHalf: 1 | 2 = nextSubTime < halfDurationSeconds ? 1 : 2;
            const newTime = newHalf === 1 ? nextSubTime : nextSubTime - halfDurationSeconds;
            
            nextSubTime += actualInterval;
            
            return { ...s, half: newHalf, time: Math.floor(newTime) };
          });
          
          console.log(`[PendingSubWidget] Skipped sub, redistributed ${numRemainingSubs} remaining subs`);
        }
        
        const updatedState = { ...pitchState, autoSubPlan: updatedPlan };
        localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(updatedState));
        
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
        
        toast({
          title: "Substitution skipped",
          description: `Remaining subs have been rescheduled`,
        });
        
        checkForPendingSub();
      }
    } catch (e) {
      console.error("[PendingSubWidget] Error skipping sub:", e);
      toast({
        title: "Error",
        description: "Failed to skip substitution",
        variant: "destructive",
      });
    }
    setShowConfirmDialog(false);
  };

  return (
    <>
      <Card className={`relative ${isDue ? "border-warning/50 bg-warning/10 animate-pulse" : "border-primary/30 bg-primary/5"}`}>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground z-10"
          onClick={handleSnooze}
          title="Snooze for 1 minute"
        >
          <X className="h-4 w-4" />
        </Button>
        <CardContent className="p-4 pr-8">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full shrink-0 ${isDue ? "bg-warning/20" : "bg-primary/10"}`}>
              {isDue ? (
                <ArrowRightLeft className="h-6 w-6 text-warning" />
              ) : (
                <Clock className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold ${isDue ? "text-warning" : "text-primary"}`}>
                {formatCountdown()}
              </p>
              <p className="text-sm text-muted-foreground truncate">
                {sub.playerOut.name} → {sub.playerIn.name}
              </p>
              {sub.positionSwap && (
                <p className="text-xs text-muted-foreground/70 truncate">
                  {sub.positionSwap.player.name} moves to {sub.positionSwap.toPosition}
                </p>
              )}
              {teamName && !sub.positionSwap && (
                <p className="text-xs text-muted-foreground">{teamName}</p>
              )}
            </div>
            <Button 
              size="sm"
              variant={isDue ? "default" : "outline"}
              className={`shrink-0 gap-1 ${isDue ? "bg-warning text-warning-foreground hover:bg-warning/90" : ""}`}
              onClick={handleAcceptClick}
            >
              {isDue ? (
                <>
                  <UserRoundCheck className="h-4 w-4" />
                  Accept Sub
                </>
              ) : (
                <>
                  View
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              {isDue ? "Make This Substitution" : "Upcoming Substitution"}
            </DialogTitle>
            <DialogDescription>
              {isDue ? "Follow these steps on the pitch" : `Sub scheduled for ${sub.half === 1 ? "1st" : "2nd"} Half`}
            </DialogDescription>
          </DialogHeader>
          
          {/* Countdown timer when not yet due */}
          {!isDue && (
            <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <Clock className="h-5 w-5 text-primary animate-pulse" />
              <div className="text-center">
                <div className="text-lg font-bold text-primary">
                  {Math.floor(secondsUntil / 60)}:{(secondsUntil % 60).toString().padStart(2, '0')}
                </div>
                <div className="text-xs text-muted-foreground">until sub is due</div>
              </div>
            </div>
          )}
          
          <div className="space-y-3 py-3">
            {/* Step 1: Player coming off */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">
                  Move {actualPlayerOut?.name} to the bench
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {actualPlayerOut?.number && `#${actualPlayerOut.number} `}
                  {actualPlayerOut?.currentPitchPosition && `leaves ${actualPlayerOut.currentPitchPosition}`}
                </div>
                {/* Edit dropdown when due */}
                {isDue && (
                  <Select
                    value={editedPlayerOutId || sub.playerOut.id}
                    onValueChange={setEditedPlayerOutId}
                  >
                    <SelectTrigger className="w-full h-8 mt-2 text-xs border-destructive/30">
                      <div className="flex items-center gap-1">
                        <Pencil className="h-3 w-3" />
                        <span>Change player</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {playersOnPitch.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.number ? `#${p.number} ` : ""}{p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <ArrowDown className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            </div>
            
            {/* Step 2: Player coming on */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">
                  Move {actualPlayerIn?.name} to {sub.positionSwap ? sub.positionSwap.fromPosition : (actualPlayerOut?.currentPitchPosition || 'the pitch')}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {actualPlayerIn?.number && `#${actualPlayerIn.number} `}
                  comes on from bench
                </div>
                {/* Edit dropdown when due */}
                {isDue && (
                  <Select
                    value={editedPlayerInId || sub.playerIn.id}
                    onValueChange={setEditedPlayerInId}
                  >
                    <SelectTrigger className="w-full h-8 mt-2 text-xs border-emerald-500/30">
                      <div className="flex items-center gap-1">
                        <Pencil className="h-3 w-3" />
                        <span>Change player</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {availableBenchPlayers.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.number ? `#${p.number} ` : ""}{p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <ArrowUp className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            </div>
            
            {/* Step 3: Position swap (if applicable) */}
            {sub.positionSwap && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                  3
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    Move {sub.positionSwap.player.name} to {sub.positionSwap.toPosition}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {sub.positionSwap.player.number && `#${sub.positionSwap.player.number} `}
                    shifts from {sub.positionSwap.fromPosition}
                  </div>
                </div>
                <ArrowRightLeft className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} className="sm:order-1">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
            {isDue ? (
              <>
                <Button variant="outline" onClick={skipSubstitution} className="sm:order-2">
                  <SkipForward className="h-4 w-4 mr-2" />
                  Skip
                </Button>
                <Button onClick={executeSubstitution} className="sm:order-3">
                  <UserRoundCheck className="h-4 w-4 mr-2" />
                  Confirm Sub
                </Button>
              </>
            ) : (
              <div className="text-xs text-muted-foreground flex items-center sm:order-2">
                Wait for countdown to confirm
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
