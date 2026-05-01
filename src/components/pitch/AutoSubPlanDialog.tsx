import { useState, useMemo, useEffect } from "react";
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
  gkRole?: 'full' | '1h' | '2h'; // GK for full game, 1st half, or 2nd half
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
  
  // Determine GK roles
  const startingGk = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  // Find the halftime GK swap (a sub at time 0 in half 2 involving the starting GK)
  const gkSwapSub = startingGk 
    ? plan.find(s => s.half === 2 && s.time === 0 && s.playerOut.id === startingGk.id)
    : null;
  
  const gkRoles = new Map<string, 'full' | '1h' | '2h'>();
  if (startingGk) {
    if (gkSwapSub) {
      gkRoles.set(startingGk.id, '1h');
      gkRoles.set(gkSwapSub.playerIn.id, '2h');
    } else {
      gkRoles.set(startingGk.id, 'full');
    }
  }
  
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
    startsOnPitch: startsOnPitchMap.get(player.id) || false,
    gkRole: gkRoles.get(player.id),
  })).sort((a, b) => b.predictedMinutes - a.predictedMinutes);
}

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
  teamSide?: "a" | "b";
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

interface MiniLeagueTeams {
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamAColor?: string;
  teamBColor?: string;
  teamAName?: string;
  teamBName?: string;
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
  rotateGkAtHalftime?: boolean; // When true, swap GK at halftime
  currentElapsedSeconds?: number; // Current game elapsed seconds (for mid-game start)
  currentHalf?: 1 | 2; // Current half (for mid-game start)
  preferredSecondHalfGkId?: string; // Preferred 2nd half GK from lineup screen
  showStepper?: boolean; // Show the Lineup → Subs step indicator
  miniLeagueTeams?: MiniLeagueTeams; // When set, generate per-team plans
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
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string
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
  // If a preferred 2nd half GK was selected, use that player; otherwise fall back to finding a GK-only bench player
  const gkOnBench = preferredSecondHalfGkId
    ? benchPlayers.find(p => p.id === preferredSecondHalfGkId) || benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1)
    : benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1);
  
  // Determine whether the starting GK will be rotated out at halftime — if so,
  // they need to be eligible for H2 outfield rotation, otherwise they sit the
  // entire 2nd half (e.g. starting GK gets 50% while everyone else gets 67–83%).
  const startingGkWillRotate = !!(rotateGkAtHalftime && gkOnPitch && startHalf === 1);
  const startingGkCanPlayOutfield = !!(
    gkOnPitch &&
    (!gkOnPitch.assignedPositions?.length ||
      gkOnPitch.assignedPositions.some(pos => pos !== "GK"))
  );
  const includeStartingGkInRotation = startingGkWillRotate && startingGkCanPlayOutfield;

  const outfieldPlayers = playerData.filter(p => {
    if (p.currentPitchPosition === "GK") {
      // Include the starting GK in the rotation pool so they can come on as
      // an outfielder in the 2nd half after the halftime GK swap.
      return includeStartingGkInRotation;
    }
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });

  const outfieldOnPitch = playersOnPitch.filter(p => p.currentPitchPosition !== "GK");
  const outfieldOnBench = benchPlayers.filter(p => {
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });
  
  if (outfieldOnBench.length === 0) {
    if (rotateGkAtHalftime && gkOnBench && gkOnPitch) {
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
  
  // Calculate remaining game time based on when we're starting
  // Clamp elapsed time to half duration to avoid negative remaining time
  const clampedStartElapsed = Math.min(startElapsedSeconds, halfDurationSeconds);
  const remainingInCurrentHalf = halfDurationSeconds - clampedStartElapsed;
  const remainingHalves = startHalf === 1 ? remainingInCurrentHalf + halfDurationSeconds : remainingInCurrentHalf;
  const totalRemainingSeconds = Math.max(remainingHalves, 0);
  const fieldPositions = teamSize - 1; // minus GK
  const totalOutfieldPlayers = outfieldPlayers.length;
  
  // CORE PRINCIPLE: Equal playing time for ALL outfield players over remaining game
  // Use remaining time for calculations
  const totalFieldSeconds = totalRemainingSeconds * fieldPositions;
  const idealSecondsPerPlayer = Math.floor(totalFieldSeconds / totalOutfieldPlayers);
  
  // Track accumulated playing time
  // Initialize playing time with already-accumulated minutes for mid-game starts
  const playingTime = new Map<string, number>();
  outfieldPlayers.forEach(p => playingTime.set(p.id, p.minutesPlayed || 0));
  
  // Track who's currently on pitch and their positions
  const currentOnPitch = new Map<string, PitchPosition>();
  outfieldOnPitch.forEach(p => {
    currentOnPitch.set(p.id, p.currentPitchPosition as PitchPosition);
  });
  
  const getPlayer = (id: string) => outfieldPlayers.find(p => p.id === id);
  
  // Calculate minimum number of subs needed to achieve equal time
  const minSubsNeeded = Math.max(outfieldOnBench.length, Math.ceil(totalOutfieldPlayers / 2));
  
  // Determine how many players to sub at once based on rotation speed and bench size
  // Key principle: batch as many subs together as possible to reduce interruptions
  // With a large bench, we want to swap multiple players simultaneously
  let subsAtOnce = 1;
  if (!disableBatchSubs && outfieldOnBench.length >= 2) {
    const hasLargeBench = outfieldOnBench.length >= 4;
    switch (rotationSpeed) {
      case 1: subsAtOnce = 1; break;
      case 2: subsAtOnce = Math.min(2, outfieldOnBench.length); break;
      case 3: subsAtOnce = Math.min(hasLargeBench ? 3 : 2, outfieldOnBench.length); break;
      default: subsAtOnce = 1;
    }
  }
  
  // Calculate the ideal number of sub windows to achieve equal playing time
  // Goal: minimize interruptions while maintaining fairness
  // Each window swaps up to subsAtOnce players, so we need fewer windows with bigger batches
  const totalSubsNeeded = Math.max(minSubsNeeded, outfieldOnBench.length);
  const idealWindows = Math.ceil(totalSubsNeeded / subsAtOnce);
  
  // Apply rotation speed modifier
  // All modes ensure every bench player gets rotated in — the difference is batch size,
  // which affects how many sub windows are needed (more windows = more interruptions)
  let subWindowsPerHalf: number;
  switch (rotationSpeed) {
    case 1: // Minimal - 1 sub at a time, so needs more windows but less disruption per window
      subWindowsPerHalf = Math.max(2, totalSubsNeeded);
      break;
    case 3: // Equal Time - bigger batches, slightly more windows for finer control
      subWindowsPerHalf = Math.max(2, idealWindows);
      break;
    case 2: // Balanced
    default:
      subWindowsPerHalf = Math.max(1, idealWindows);
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
        
        // Use a 30-second minimum threshold instead of hard zero to allow
        // beneficial rotations when times are close but not exactly equal
        if (timeDiffCorrected < 30) continue;
        
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
  
  // Threshold: subs within this many seconds of half-end get snapped
  const END_OF_HALF_SNAP_THRESHOLD = 60;

  // Pre-compute who will become GK at halftime so we can correctly model the
  // outfield rotation pool in the 2nd half (the new GK is no longer an outfielder).
  // The H2 GK can be: (a) the explicit `gkOnBench` candidate, (b) a starter on
  // pitch who was selected as `preferredSecondHalfGkId`, or (c) the fallback
  // pick at halftime — any GK-eligible bench player least played at that point.
  // We must commit to a single H2 GK upfront so the bonus protects them
  // consistently across both halves.
  const preferredOnPitchGk = preferredSecondHalfGkId
    ? playersOnPitch.find(p => p.id === preferredSecondHalfGkId && p.currentPitchPosition !== "GK")
    : undefined;
  // Predict the fallback halftime GK (least-played GK-eligible bench player).
  // At plan-generation time, all bench players have equal accumulated minutes,
  // so this picks the first GK-eligible bench player (or any bench player if
  // none have positions assigned).
  const predictedFallbackGk = !gkOnBench && !preferredOnPitchGk && rotateGkAtHalftime && gkOnPitch
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") || !p.assignedPositions?.length) || null
    : null;
  const halftimeGkIn = startingGkWillRotate
    ? (gkOnBench || preferredOnPitchGk || predictedFallbackGk || null)
    : null;

  // GK FAIRNESS: anyone who plays GK in either half only has ~half the game
  // available for outfield time. To ensure they end up with at least as many
  // total minutes as full-game outfielders, give them a strong priority bonus
  // when sorting the bench (so they're always picked first to come on) and
  // when sorting on-pitch players (so they're never picked to come off until
  // they've caught up). The bonus is huge so it dominates normal time-diff
  // sorting but doesn't affect actual accumulated minutes used for fairness.
  const GK_PRIORITY_BONUS = halfDurationSeconds * 10;
  const isGkPlayer = (id: string) =>
    (includeStartingGkInRotation && id === gkOnPitch?.id) ||
    (halftimeGkIn ? id === halftimeGkIn.id : false);
  // Adjusted time for sorting: GKs appear "less played" everywhere so they
  // jump to top of bench (picked first ON) and bottom of pitch (picked last OFF).
  // While on pitch in H1, this also makes them last to be picked off, so a
  // future-GK starter accumulates max outfield time before going in goal.
  const adjustedTime = (id: string) =>
    (playingTime.get(id) || 0) - (isGkPlayer(id) ? GK_PRIORITY_BONUS : 0);

  // Process each half (start from current half for mid-game)
  for (let half = startHalf; half <= 2; half++) {
    const isStartHalf = half === startHalf;

    // At the start of H2, apply the halftime GK swap to the simulation state:
    // the incoming GK leaves the outfield pool (they're now in goal). The
    // outgoing GK is already off the pitch and will be rotated in normally.
    if (half === 2 && halftimeGkIn && currentOnPitch.has(halftimeGkIn.id)) {
      currentOnPitch.delete(halftimeGkIn.id);
    }

    const halfRemaining = isStartHalf ? halfDurationSeconds - startElapsedSeconds : halfDurationSeconds;
    const rawSubTimes = generateSubTimes(halfRemaining, actualWindowsPerHalf)
      .map(t => isStartHalf ? t + startElapsedSeconds : t); // Offset times for current half

    // Filter subs too close to end of half:
    // - First half: snap to halftime (half 2, time 0)
    // - Second half: drop entirely (don't sub someone off within 1 min of full time)
    const subTimes: number[] = [];
    const deferredToHalftime: number[] = [];
    for (const t of rawSubTimes) {
      if ((halfDurationSeconds - t) <= END_OF_HALF_SNAP_THRESHOLD) {
        if (half === 1) {
          deferredToHalftime.push(t);
        }
        // half === 2: drop — no point subbing within 1 min of full time
      } else {
        subTimes.push(t);
      }
    }

    let lastEventTime = isStartHalf ? startElapsedSeconds : 0;
    
    for (const subTime of subTimes) {
      // Add elapsed time to players currently on pitch
      const elapsed = subTime - lastEventTime;
      currentOnPitch.forEach((_, id) => {
        playingTime.set(id, (playingTime.get(id) || 0) + elapsed);
      });
      lastEventTime = subTime;
      
      // Get sorted lists — use GK-adjusted time so goalkeepers are prioritised
      // (picked first off the bench, picked last off the pitch).
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: adjustedTime(id), player: getPlayer(id)! }))
        .filter(p => p.player)
        .sort((a, b) => b.time - a.time);
      
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        // Starting GK is in the rotation pool but NOT actually available until
        // they come off goal at halftime — exclude them from H1 sub windows.
        .filter(p => !(includeStartingGkInRotation && half === 1 && p.id === gkOnPitch?.id))
        // Halftime GK substitute is in goal during H2, not on the bench.
        .filter(p => !(half === 2 && halftimeGkIn && p.id === halftimeGkIn.id))
        .map(p => ({ id: p.id, time: adjustedTime(p.id), player: p }))
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
        // Use 30s threshold for consistency with candidate scoring
        if (subIdx === 0 && (mostPlayedOnPitch.time - leastPlayedOnBench.time) < 30) break;
        
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

    // Process deferred end-of-half subs as halftime subs (half 2, time 0)
    if (half === 1 && deferredToHalftime.length > 0) {
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: adjustedTime(id), player: getPlayer(id)! }))
        .filter(p => p.player)
        .sort((a, b) => b.time - a.time);
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        // Starting GK is still in goal at the end of H1 — not a real bench option here.
        .filter(p => !(includeStartingGkInRotation && p.id === gkOnPitch?.id))
        .map(p => ({ id: p.id, time: adjustedTime(p.id), player: p }))
        .sort((a, b) => a.time - b.time);
      const usedOutIds = new Set<string>();
      const usedInIds = new Set<string>();
      for (let di = 0; di < deferredToHalftime.length; di++) {
        const availableOnPitch = onPitchSorted.filter(p => !usedOutIds.has(p.id));
        const availableBench = benchSorted.filter(p => !usedInIds.has(p.id));
        if (availableOnPitch.length === 0 || availableBench.length === 0) break;
        const best = findBestSubCandidate(onPitchSorted, benchSorted, usedOutIds, usedInIds);
        if (best) {
          const incomingPosition = best.positionSwap
            ? best.positionSwap.fromPosition
            : currentOnPitch.get(best.playerOut.id);
          plan.push({
            time: 0,
            half: 2,
            playerOut: best.playerOut,
            playerIn: best.playerIn,
            positionSwap: best.positionSwap,
            executed: false,
          });
          usedOutIds.add(best.playerOut.id);
          usedInIds.add(best.playerIn.id);
          currentOnPitch.delete(best.playerOut.id);
          currentOnPitch.set(best.playerIn.id, incomingPosition!);
          if (best.positionSwap) {
            currentOnPitch.set(best.positionSwap.player.id, best.positionSwap.toPosition);
          }
        } else {
          break;
        }
      }
    }
  }
  
  // Handle GK substitution at halftime (only if we haven't passed halftime)
  if (rotateGkAtHalftime && gkOnPitch && startHalf === 1) {
    // Use dedicated GK bench player if available, otherwise pick a GK-eligible bench player
    // If no one is eligible for GK, keep the original GK on pitch
    const gkReplacementPlayer = gkOnBench || (() => {
      const benchAtHalftime = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        .map(p => ({ player: p, time: playingTime.get(p.id) || 0 }))
        .sort((a, b) => a.time - b.time);
      // Eligible: players with GK in assigned positions, OR players with no positions set (eligible for all)
      const gkEligible = benchAtHalftime.filter(p => 
        p.player.assignedPositions?.includes("GK") || !p.player.assignedPositions?.length
      );
      return gkEligible[0]?.player || null;
    })();
    
    if (gkReplacementPlayer) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkReplacementPlayer,
        executed: false,
      });
    }
  }
  
  // Snap subs scheduled within 60s of the start of a half to time 0 (half-time sub)
  // This avoids scheduling a sub e.g. 14 seconds into the 2nd half when it should just happen at half time
  const HALF_BOUNDARY_THRESHOLD = 60;
  for (const sub of plan) {
    if (sub.time > 0 && sub.time <= HALF_BOUNDARY_THRESHOLD) {
      sub.time = 0;
    }
  }
  
  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
  // FAIRNESS SIMULATION PASS: verify max-min playing time spread
  // If spread exceeds 20% of ideal time, add corrective subs
  const simOnPitch = new Map<string, PitchPosition>();
  outfieldOnPitch.forEach(p => simOnPitch.set(p.id, p.currentPitchPosition as PitchPosition));
  const simTime = new Map<string, number>();
  outfieldPlayers.forEach(p => simTime.set(p.id, p.minutesPlayed || 0));
  
  // Simulate the plan
  let simLastTime = startHalf === 1 ? startElapsedSeconds : startElapsedSeconds;
  let simLastHalf = startHalf;
  for (const sub of plan) {
    // Advance time for on-pitch players
    let elapsed = 0;
    if (sub.half === simLastHalf) {
      elapsed = sub.time - simLastTime;
    } else {
      // Half changed: add remaining time from first half + time into second half
      elapsed = (halfDurationSeconds - simLastTime) + sub.time;
    }
    if (elapsed > 0) {
      simOnPitch.forEach((_, id) => simTime.set(id, (simTime.get(id) || 0) + elapsed));
    }
    simLastTime = sub.time;
    simLastHalf = sub.half;
    
    // Apply the sub — track positions through simulation, not from the main algo's final state
    const outPos = simOnPitch.get(sub.playerOut.id);
    simOnPitch.delete(sub.playerOut.id);
    if (sub.positionSwap) {
      // Incoming player takes the swap player's position
      const swapFromPos = simOnPitch.get(sub.positionSwap.player.id);
      if (swapFromPos) simOnPitch.set(sub.playerIn.id, swapFromPos);
      // Swap player moves to the outgoing player's position
      if (outPos) simOnPitch.set(sub.positionSwap.player.id, outPos);
    } else {
      if (outPos) simOnPitch.set(sub.playerIn.id, outPos);
    }
  }
  // Add remaining game time
  const endElapsed = halfDurationSeconds - simLastTime;
  if (endElapsed > 0) simOnPitch.forEach((_, id) => simTime.set(id, (simTime.get(id) || 0) + endElapsed));
  if (simLastHalf === 1) {
    // Add full second half
    simOnPitch.forEach((_, id) => simTime.set(id, (simTime.get(id) || 0) + halfDurationSeconds));
  }
  
  // Check fairness spread
  const outfieldTimes = outfieldPlayers.map(p => simTime.get(p.id) || 0);
  const maxTime = Math.max(...outfieldTimes);
  const minTime = Math.min(...outfieldTimes);
  const spread = maxTime - minTime;
  const fairnessThreshold = idealSecondsPerPlayer * 0.2;
  
  // If spread is too large and we have room for a corrective sub, add one
  if (spread > fairnessThreshold && spread > 60) {
    const overplayedId = outfieldPlayers.find(p => (simTime.get(p.id) || 0) === maxTime)?.id;
    const underplayedId = outfieldPlayers.find(p => (simTime.get(p.id) || 0) === minTime)?.id;
    
    if (overplayedId && underplayedId) {
      const overplayed = getPlayer(overplayedId);
      const underplayed = getPlayer(underplayedId);
      
      // Only add corrective sub if overplayed is on pitch in final state
      if (overplayed && underplayed && simOnPitch.has(overplayedId) && !simOnPitch.has(underplayedId)) {
        // Schedule corrective sub 2 minutes before end of last half
        const correctiveTime = Math.max(0, halfDurationSeconds - 120);
        const correctiveHalf = 2 as 1 | 2;
        
        // Don't add if there's already a sub at this time for these players
        const alreadyExists = plan.some(s => 
          s.half === correctiveHalf && 
          Math.abs(s.time - correctiveTime) < 30 &&
          (s.playerOut.id === overplayedId || s.playerIn.id === underplayedId)
        );
        
        if (!alreadyExists) {
          plan.push({
            time: correctiveTime,
            half: correctiveHalf,
            playerOut: overplayed,
            playerIn: underplayed,
            executed: false,
          });
          
          // Re-sort after adding corrective sub
          plan.sort((a, b) => {
            if (a.half !== b.half) return a.half - b.half;
            return a.time - b.time;
          });
        }
      }
    }
  }
  
  return plan;
}

// Generate per-team plans for mini-league mode and merge them
function createMiniLeagueSubPlan(
  players: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeed: number,
  disablePositionSwaps: boolean,
  disableBatchSubs: boolean,
  rotateGkAtHalftime: boolean,
  startElapsedSeconds: number,
  startHalf: 1 | 2,
  miniLeagueTeams: MiniLeagueTeams,
  preferredSecondHalfGkId?: string
): SubstitutionEvent[] {
  const teamAPlayers = players.filter(p => p.teamSide === "a");
  const teamBPlayers = players.filter(p => p.teamSide === "b");
  
  const planA = teamAPlayers.length > 0
    ? createSubPlan(teamAPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, preferredSecondHalfGkId)
    : [];
  
  const planB = teamBPlayers.length > 0
    ? createSubPlan(teamBPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf)
    : [];
  
  // Merge and sort by half then time
  const merged = [...planA, ...planB];
  merged.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
  return merged;
}


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
  disableBatchSubs = false,
  rotateGkAtHalftime = true,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  isSetupFlow = false,
  miniLeagueTeams,
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
  rotateGkAtHalftime?: boolean;
  currentElapsedSeconds?: number;
  currentHalf?: 1 | 2;
  preferredSecondHalfGkId?: string;
  isSetupFlow?: boolean;
  miniLeagueTeams?: MiniLeagueTeams;
}) {
  // Treat empty existing plans (all executed/empty) as no plan so auto-generation kicks in
  const effectiveExistingPlan = existingPlan && existingPlan.some(s => !s.executed) ? existingPlan : undefined;
  const [plan, setPlan] = useState<SubstitutionEvent[] | null>(effectiveExistingPlan || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'forecast' | 'edit'>(editMode ? 'edit' : 'forecast');
  
  const generatePlan = (allPlayers: Player[]) => {
    const halfDurationSeconds = minutesPerHalf * 60;
    if (miniLeagueTeams) {
      return createMiniLeagueSubPlan(allPlayers, teamSize, halfDurationSeconds, rotationSpeed!, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId);
    }
    return createSubPlan(allPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId);
  };
  
  // Auto-generate plan on mount if no existing plan
  useEffect(() => {
    if (plan === null && !isGenerating && !editMode) {
      const playersOnP = players.filter(p => p.position !== null);
      const benchP = players.filter(p => p.position === null);
      // In mini-league mode, check per-team bench availability
      const hasEnough = miniLeagueTeams
        ? playersOnP.length > 0 && benchP.length > 0
        : playersOnP.length >= teamSize && benchP.length > 0;
      if (hasEnough) {
        setIsGenerating(true);
        setTimeout(() => {
          try {
            const generatedPlan = generatePlan(players);
            setPlan(generatedPlan);
          } catch (error) {
            console.error("Error auto-generating plan:", error);
            setPlan([]);
          } finally {
            setIsGenerating(false);
          }
        }, 10);
      }
    }
  }, []); // Run once on mount
  
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  const hasEnoughPlayers = miniLeagueTeams
    ? playersOnPitch.length > 0 && benchPlayers.length > 0
    : playersOnPitch.length >= teamSize && benchPlayers.length > 0;
  
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
        const generatedPlan = generatePlan(players);
        console.log("[AutoSubPlan] Generated", generatedPlan.length, "subs", miniLeagueTeams ? "(mini-league per-team)" : "");
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
          {benchPlayers.length === 0 
            ? "No bench players available — auto-substitutions aren't needed."
            : `You need ${teamSize} players on pitch and at least 1 on the bench to generate a substitution plan.`
          }
        </p>
        <p className="text-sm text-muted-foreground">
          Current: {playersOnPitch.length} on pitch, {benchPlayers.length} on bench
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">
          <Play className="h-4 w-4" />
          {benchPlayers.length === 0 ? "Continue to Pitch Board" : "Go Back"}
        </Button>
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
        <button
          onClick={onClose}
          className="mt-2 w-full max-w-xs rounded-lg border border-border bg-muted/30 p-3 text-center transition-colors hover:bg-muted/50 active:bg-muted/70"
        >
          <span className="text-sm font-medium text-foreground">Skip</span>
          <p className="mt-1 text-xs text-muted-foreground">
            You can make substitutions and swaps manually during the game instead
          </p>
        </button>
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
          <div className="pr-1">
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
                      {forecast.gkRole && (
                        <Badge 
                          variant="outline" 
                          className="text-xs px-1.5 py-0 border-amber-500/50 text-amber-600"
                        >
                          {forecast.gkRole === 'full' ? 'GK' : forecast.gkRole === '1h' ? 'GK 1H' : 'GK 2H'}
                        </Badge>
                      )}
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
          </div>
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
        <Button variant="outline" onClick={onClose}>
          {isSetupFlow ? "Skip — do subs manually" : "Cancel"}
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
  rotateGkAtHalftime = true,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  showStepper = false,
  miniLeagueTeams,
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
            "bg-background duration-200 overflow-hidden pt-[env(safe-area-inset-top)] landscape:pt-1",
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
            <div className="flex items-center gap-3">
              {!editMode && showStepper && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Lineup</span>
                  <span className="text-muted-foreground/50 mx-0.5">→</span>
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                  <span className="font-medium text-foreground">Subs</span>
                </div>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
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
                rotateGkAtHalftime={rotateGkAtHalftime}
                currentElapsedSeconds={currentElapsedSeconds}
                currentHalf={currentHalf}
                preferredSecondHalfGkId={preferredSecondHalfGkId}
                isSetupFlow={showStepper}
                miniLeagueTeams={miniLeagueTeams}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
