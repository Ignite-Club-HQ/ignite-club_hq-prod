import { useState, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Clock, Play, AlertTriangle, RefreshCw, Loader2, X, BarChart3, Pencil } from "lucide-react";
import { PitchPosition } from "./PositionBadge";
import { cn } from "@/lib/utils";
import SubPlanEditor from "./SubPlanEditor";


interface PlayerTimeForecast {
  player: Player;
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
}

// Calculate playing time forecast for each player based on the plan
function calculateTimeForecasts(
  players: Player[],
  plan: SubstitutionEvent[],
  minutesPerHalf: number
): PlayerTimeForecast[] {
  const totalGameMinutes = minutesPerHalf * 2;
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  
  // Track time on pitch for each player
  const timeOnPitch = new Map<string, number>();
  const startsOnPitchMap = new Map<string, boolean>();
  
  // Initialize all players
  players.forEach(p => {
    timeOnPitch.set(p.id, 0);
    startsOnPitchMap.set(p.id, p.position !== null);
  });
  
  // Track who's on pitch at any moment
  const currentOnPitch = new Set(playersOnPitch.map(p => p.id));
  
  // Process each half
  for (const half of [1, 2]) {
    const halfSubs = plan.filter(s => s.half === half).sort((a, b) => a.time - b.time);
    let lastTime = 0;
    
    for (const sub of halfSubs) {
      // Add time elapsed since last event for players on pitch
      const elapsed = sub.time - lastTime;
      currentOnPitch.forEach(playerId => {
        timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + elapsed);
      });
      
      // Execute substitution
      currentOnPitch.delete(sub.playerOut.id);
      currentOnPitch.add(sub.playerIn.id);
      lastTime = sub.time;
    }
    
    // Add remaining time in the half
    const remainingInHalf = (minutesPerHalf * 60) - lastTime;
    currentOnPitch.forEach(playerId => {
      timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + remainingInHalf);
    });
  }
  
  // Convert to forecast objects
  return players.map(player => ({
    player,
    predictedMinutes: Math.round((timeOnPitch.get(player.id) || 0) / 60),
    percentageOfGame: Math.round(((timeOnPitch.get(player.id) || 0) / 60 / totalGameMinutes) * 100),
    startsOnPitch: startsOnPitchMap.get(player.id) || false
  })).sort((a, b) => b.predictedMinutes - a.predictedMinutes);
}

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

interface AutoSubPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number; // 1 = slow, 2 = medium, 3 = fast
  disablePositionSwaps?: boolean; // When true, skip position swaps in auto generation
  disableBatchSubs?: boolean; // When true, only do one sub at a time
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

function createSubPlan(
  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeed: number = 2,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false
): SubstitutionEvent[] {
  const plan: SubstitutionEvent[] = [];
  
  if (!playerData || playerData.length === 0 || teamSize <= 0 || halfDurationSeconds <= 0) {
    return [];
  }
  
  const playersOnPitch = playerData.filter(p => p.position !== null);
  const benchPlayers = playerData.filter(p => p.position === null);
  
  if (benchPlayers.length === 0) return [];
  
  // Separate GK from outfield players
  const gkOnPitch = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  const gkOnBench = benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1);
  
  const outfieldPlayers = playerData.filter(p => {
    if (p.currentPitchPosition === "GK") return false;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });
  
  const outfieldOnPitch = playersOnPitch.filter(p => p.currentPitchPosition !== "GK");
  const outfieldOnBench = benchPlayers.filter(p => {
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });
  
  if (outfieldOnBench.length === 0) {
    if (gkOnBench && gkOnPitch) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkOnBench,
        executed: false,
      });
    }
    return plan;
  }
  
  const totalGameSeconds = halfDurationSeconds * 2;
  const fieldPositions = teamSize - 1; // minus GK
  const totalOutfieldPlayers = outfieldPlayers.length;
  
  // CORE PRINCIPLE: Equal playing time for ALL outfield players
  // Total field-seconds available = game duration * number of field positions
  // Each player should get exactly: totalFieldSeconds / totalOutfieldPlayers
  const totalFieldSeconds = totalGameSeconds * fieldPositions;
  const idealSecondsPerPlayer = Math.floor(totalFieldSeconds / totalOutfieldPlayers);
  
  // Track accumulated playing time
  const playingTime = new Map<string, number>();
  outfieldPlayers.forEach(p => playingTime.set(p.id, 0));
  
  // Track who's currently on pitch and their positions
  const currentOnPitch = new Map<string, PitchPosition>();
  outfieldOnPitch.forEach(p => {
    currentOnPitch.set(p.id, p.currentPitchPosition as PitchPosition);
  });
  
  const getPlayer = (id: string) => outfieldPlayers.find(p => p.id === id);
  
  // Calculate minimum number of subs needed to achieve equal time
  const minSubsNeeded = Math.max(outfieldOnBench.length, Math.ceil(totalOutfieldPlayers / 2));
  
  // Determine how many players to sub at once based on rotation speed and bench size
  // Only batch subs if there are 2+ bench players and batch subs not disabled
  let subsAtOnce = 1;
  if (!disableBatchSubs && outfieldOnBench.length >= 2) {
    switch (rotationSpeed) {
      case 1: // Slow - always single subs
        subsAtOnce = 1;
        break;
      case 2: // Medium - up to 2 at a time if bench allows
        subsAtOnce = Math.min(2, outfieldOnBench.length);
        break;
      case 3: // Fast - up to 3 at a time if bench allows
        subsAtOnce = Math.min(3, outfieldOnBench.length);
        break;
      default:
        subsAtOnce = 1;
    }
  }
  
  // Apply rotation speed - controls how many sub windows per half
  // Since we're doing batch subs now, we need fewer windows
  let subWindowsPerHalf: number;
  switch (rotationSpeed) {
    case 1: // Slow - fewer windows
      subWindowsPerHalf = Math.max(2, Math.ceil(minSubsNeeded / subsAtOnce));
      break;
    case 3: // Fast - more windows
      subWindowsPerHalf = Math.max(4, Math.ceil(minSubsNeeded * 1.5 / subsAtOnce));
      break;
    case 2: // Medium - balanced
    default:
      subWindowsPerHalf = Math.max(3, Math.ceil(minSubsNeeded * 1.2 / subsAtOnce));
      break;
  }
  
  // Minimum 45 seconds between sub windows for practicality
  const minSubInterval = 45;
  const maxWindowsPerHalf = Math.floor(halfDurationSeconds / minSubInterval);
  const actualWindowsPerHalf = Math.min(subWindowsPerHalf, maxWindowsPerHalf);
  
  // Generate sub window times evenly distributed
  const generateSubTimes = (halfDuration: number, numWindows: number): number[] => {
    const times: number[] = [];
    if (numWindows <= 0) return times;
    const interval = halfDuration / (numWindows + 1);
    for (let i = 1; i <= numWindows; i++) {
      times.push(Math.floor(i * interval));
    }
    return times;
  };
  
  // Helper to find best substitution candidate
  const findBestSubCandidate = (
    onPitchSorted: { id: string; time: number; player: Player }[],
    benchSorted: { id: string; time: number; player: Player }[],
    excludePlayerOutIds: Set<string>,
    excludePlayerInIds: Set<string>
  ) => {
    interface SubCandidate {
      playerOut: Player;
      playerIn: Player;
      positionSwap?: SubstitutionEvent["positionSwap"];
      score: number;
      positionValid: boolean;
    }
    
    const candidates: SubCandidate[] = [];
    
    const filteredOnPitch = onPitchSorted.filter(p => !excludePlayerOutIds.has(p.id));
    const filteredBench = benchSorted.filter(p => !excludePlayerInIds.has(p.id));
    
    for (const benchEntry of filteredBench) {
      for (const pitchEntry of filteredOnPitch) {
        const pitchPos = currentOnPitch.get(pitchEntry.id);
        const timeDiffCorrected = pitchEntry.time - benchEntry.time;
        
        if (timeDiffCorrected <= 0) continue;
        
        const directMatch = !benchEntry.player.assignedPositions?.length || 
            benchEntry.player.assignedPositions.includes(pitchPos!);
        
        if (directMatch) {
          candidates.push({
            playerOut: pitchEntry.player,
            playerIn: benchEntry.player,
            score: timeDiffCorrected,
            positionValid: true
          });
        }
        
        if (!disablePositionSwaps) {
          const pitchPlayers = Array.from(currentOnPitch.entries());
          for (const [swapId, swapPos] of pitchPlayers) {
            if (swapId === pitchEntry.id || excludePlayerOutIds.has(swapId)) continue;
            const swapPlayer = getPlayer(swapId);
            if (!swapPlayer) continue;
            
            const swapPlayerCanPlayOutPos = !swapPlayer.assignedPositions?.length || 
                swapPlayer.assignedPositions.includes(pitchPos!);
            const incomingCanPlaySwapPos = !benchEntry.player.assignedPositions?.length || 
                benchEntry.player.assignedPositions.includes(swapPos);
            
            if (swapPlayerCanPlayOutPos && incomingCanPlaySwapPos) {
              candidates.push({
                playerOut: pitchEntry.player,
                playerIn: benchEntry.player,
                positionSwap: {
                  player: swapPlayer,
                  fromPosition: swapPos,
                  toPosition: pitchPos!,
                },
                score: timeDiffCorrected,
                positionValid: true
              });
            }
          }
        }
        
        if (!candidates.some(c => c.playerOut.id === pitchEntry.player.id && c.playerIn.id === benchEntry.player.id && c.positionValid)) {
          candidates.push({
            playerOut: pitchEntry.player,
            playerIn: benchEntry.player,
            score: timeDiffCorrected * 0.5,
            positionValid: false
          });
        }
      }
    }
    
    candidates.sort((a, b) => {
      if (a.positionValid !== b.positionValid) return b.positionValid ? 1 : -1;
      return b.score - a.score;
    });
    
    return candidates[0] || null;
  };
  
  // Process each half
  for (let half = 1; half <= 2; half++) {
    const subTimes = generateSubTimes(halfDurationSeconds, actualWindowsPerHalf);
    let lastEventTime = 0;
    
    for (const subTime of subTimes) {
      // Add elapsed time to players currently on pitch
      const elapsed = subTime - lastEventTime;
      currentOnPitch.forEach((_, id) => {
        playingTime.set(id, (playingTime.get(id) || 0) + elapsed);
      });
      lastEventTime = subTime;
      
      // Get sorted lists
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: playingTime.get(id) || 0, player: getPlayer(id)! }))
        .filter(p => p.player)
        .sort((a, b) => b.time - a.time);
      
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        .map(p => ({ id: p.id, time: playingTime.get(p.id) || 0, player: p }))
        .sort((a, b) => a.time - b.time);
      
      if (onPitchSorted.length === 0 || benchSorted.length === 0) continue;
      
      // Determine how many subs to make at this time window
      const currentBenchSize = benchSorted.length;
      const subsThisWindow = Math.min(subsAtOnce, currentBenchSize, onPitchSorted.length);
      
      // Track which players we've already used in this window
      const usedPlayerOutIds = new Set<string>();
      const usedPlayerInIds = new Set<string>();
      
      for (let subIdx = 0; subIdx < subsThisWindow; subIdx++) {
        // Refresh sorted lists excluding already-used players
        const availableOnPitch = onPitchSorted.filter(p => !usedPlayerOutIds.has(p.id));
        const availableBench = benchSorted.filter(p => !usedPlayerInIds.has(p.id));
        
        if (availableOnPitch.length === 0 || availableBench.length === 0) break;
        
        const mostPlayedOnPitch = availableOnPitch[0];
        const leastPlayedOnBench = availableBench[0];
        
        // Only check time difference for the first sub of a batch window
        // Additional batch subs are made to rotate more players together
        if (subIdx === 0 && mostPlayedOnPitch.time <= leastPlayedOnBench.time) break;
        
        const best = findBestSubCandidate(onPitchSorted, benchSorted, usedPlayerOutIds, usedPlayerInIds);
        
        if (best) {
          const incomingPosition = best.positionSwap 
            ? best.positionSwap.fromPosition 
            : currentOnPitch.get(best.playerOut.id);
          
          plan.push({
            time: subTime,
            half: half as 1 | 2,
            playerOut: best.playerOut,
            playerIn: best.playerIn,
            positionSwap: best.positionSwap,
            executed: false,
          });
          
          // Mark players as used in this window
          usedPlayerOutIds.add(best.playerOut.id);
          usedPlayerInIds.add(best.playerIn.id);
          
          // Update pitch state
          currentOnPitch.delete(best.playerOut.id);
          currentOnPitch.set(best.playerIn.id, incomingPosition!);
          
          if (best.positionSwap) {
            currentOnPitch.set(best.positionSwap.player.id, best.positionSwap.toPosition);
          }
        } else {
          break; // No valid subs found
        }
      }
    }
    
    // Add remaining time in half
    const remainingTime = halfDurationSeconds - lastEventTime;
    currentOnPitch.forEach((_, id) => {
      playingTime.set(id, (playingTime.get(id) || 0) + remainingTime);
    });
  }
  
  // Handle GK substitution at halftime
  if (gkOnBench && gkOnPitch) {
    plan.push({
      time: 0,
      half: 2,
      playerOut: gkOnPitch,
      playerIn: gkOnBench,
      executed: false,
    });
  }
  
  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
  return plan;
}

// Separate content component to isolate re-renders
function DialogInner({ 
  players, 
  teamSize, 
  minutesPerHalf, 
  onStartPlan,
  onClose,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false
}: {
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  onClose: () => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number;
  disablePositionSwaps?: boolean;
  disableBatchSubs?: boolean;
}) {
  const [plan, setPlan] = useState<SubstitutionEvent[] | null>(existingPlan || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'forecast' | 'edit'>(editMode ? 'edit' : 'forecast');
  
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  const hasEnoughPlayers = playersOnPitch.length >= teamSize && benchPlayers.length > 0;
  
  // Calculate time forecasts when plan exists
  const forecasts = useMemo(() => {
    if (!plan) return [];
    return calculateTimeForecasts(players, plan, minutesPerHalf);
  }, [plan, players, minutesPerHalf]);
  
  const handleGenerate = () => {
    setIsGenerating(true);
    console.log("[AutoSubPlan] Generating with rotationSpeed:", rotationSpeed, "minutesPerHalf:", minutesPerHalf, "disableBatchSubs:", disableBatchSubs);
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      try {
        const halfDurationSeconds = minutesPerHalf * 60;
        const generatedPlan = createSubPlan(players, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs);
        console.log("[AutoSubPlan] Generated", generatedPlan.length, "subs");
        setPlan(generatedPlan);
      } catch (error) {
        console.error("Error generating plan:", error);
        setPlan([]);
      } finally {
        setIsGenerating(false);
      }
    }, 10);
  };
  
  const handleStart = () => {
    if (plan && plan.length > 0) {
      onStartPlan(plan);
      onClose();
    }
  };
  
  if (!hasEnoughPlayers) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <p className="text-center text-muted-foreground">
          You need {teamSize} players on pitch and at least 1 on the bench to generate a substitution plan.
        </p>
        <p className="text-sm text-muted-foreground">
          Current: {playersOnPitch.length} on pitch, {benchPlayers.length} on bench
        </p>
      </div>
    );
  }
  
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Generating substitution plan...</p>
      </div>
    );
  }
  
  if (plan === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Clock className="h-12 w-12 text-primary" />
        <p className="text-center text-muted-foreground">
          Generate an automatic substitution plan to give all {players.length} players equal playing time.
        </p>
        <Button onClick={handleGenerate} className="gap-2">
          <Play className="h-4 w-4" />
          Generate Plan
        </Button>
      </div>
    );
  }
  
  return (
    <>
      <div className="space-y-4">
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <Button
            variant={activeTab === 'forecast' ? "default" : "ghost"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setActiveTab('forecast')}
          >
            <BarChart3 className="h-4 w-4" />
            Projected Minutes
          </Button>
          <Button
            variant={activeTab === 'edit' ? "default" : "ghost"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setActiveTab('edit')}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </div>
        
        {activeTab === 'forecast' && (
          /* Playing Time Forecast */
          <ScrollArea className="h-[280px] pr-4">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Predicted playing time based on {plan.length} substitution{plan.length !== 1 ? 's' : ''} over {minutesPerHalf * 2} minutes
              </p>
              {forecasts.map(forecast => (
                <div 
                  key={forecast.player.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
                    {forecast.player.number || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {forecast.player.name}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs px-1.5 py-0",
                          forecast.startsOnPitch 
                            ? "border-emerald-500/50 text-emerald-500" 
                            : "border-muted-foreground/50"
                        )}
                      >
                        {forecast.startsOnPitch ? 'Start' : 'Bench'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={forecast.percentageOfGame} 
                        className="h-2 flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-20 text-right shrink-0">
                        {forecast.predictedMinutes}' ({forecast.percentageOfGame}%)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {activeTab === 'edit' && (
          /* Manual Edit Mode */
          <SubPlanEditor
            plan={plan}
            players={players}
            minutesPerHalf={minutesPerHalf}
            teamSize={teamSize}
            onPlanChange={setPlan}
          />
        )}
      </div>
      
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={handleGenerate} className="gap-2 mr-auto">
          <RefreshCw className="h-4 w-4" />
          Regenerate
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleStart} className="gap-2" disabled={plan.length === 0}>
          <Play className="h-4 w-4" />
          Start Plan
        </Button>
      </div>
    </>
  );
}

export default function AutoSubPlanDialog({
  open,
  onOpenChange,
  players,
  teamSize,
  minutesPerHalf,
  onStartPlan,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false,
}: AutoSubPlanDialogProps) {
  const handleClose = () => onOpenChange(false);
  
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
            "fixed inset-0 z-[99999] flex flex-col",
            "bg-background duration-200 overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between p-4 border-b border-border">
            <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {editMode ? "Edit Substitution Plan" : "Auto Substitution Plan"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          
          <div className="flex-1 overflow-auto p-4">
            {open && (
              <DialogInner
                players={players}
                teamSize={teamSize}
                minutesPerHalf={minutesPerHalf}
                onStartPlan={onStartPlan}
                onClose={handleClose}
                existingPlan={existingPlan}
                editMode={editMode}
                rotationSpeed={rotationSpeed}
                disablePositionSwaps={disablePositionSwaps}
                disableBatchSubs={disableBatchSubs}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
