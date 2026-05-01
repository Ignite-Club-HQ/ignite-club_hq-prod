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
  /** Max acceptable playing-time spread (minutes). Planner stays in queue
   *  (FIFO) order while projected spread is within this cap; once projected
   *  to exceed it, fairness overrides queue. Defaults to 5 minutes. */
  maxSpreadMinutes?: number;
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

export function createSubPlan(
  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeed: number = 2,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5
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

  const preferredOnPitchGk = preferredSecondHalfGkId
    ? playersOnPitch.find(p => p.id === preferredSecondHalfGkId && p.currentPitchPosition !== "GK")
    : undefined;
  const predictedFallbackGk = !gkOnBench && !preferredOnPitchGk && rotateGkAtHalftime && gkOnPitch
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") || !p.assignedPositions?.length) || null
    : null;
  const halftimeGkIn = rotateGkAtHalftime && gkOnPitch && startHalf === 1
    ? (gkOnBench || preferredOnPitchGk || predictedFallbackGk || null)
    : null;
  
  // Determine whether the starting GK will be rotated out at halftime — if so,
  // they need to be eligible for H2 outfield rotation, otherwise they sit the
  // entire 2nd half (e.g. starting GK gets 50% while everyone else gets 67–83%).
  const startingGkWillRotate = !!(rotateGkAtHalftime && gkOnPitch && startHalf === 1);
  const startingGkCanPlayOutfield = !!gkOnPitch;
  const includeStartingGkInRotation = startingGkWillRotate && startingGkCanPlayOutfield;

  const outfieldPlayers = playerData.filter(p => {
    if (p.currentPitchPosition === "GK") {
      // Include the starting GK in the rotation pool so they can come on as
      // an outfielder in the 2nd half after the halftime GK swap.
      return includeStartingGkInRotation;
    }
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });

  const outfieldOnPitch = playersOnPitch.filter(p => p.currentPitchPosition !== "GK");
  const outfieldOnBench = benchPlayers.filter(p => {
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
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
  const fieldPositions = outfieldOnPitch.length || Math.max(teamSize - (gkOnPitch ? 1 : 0), 1);
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

  // FAIRNESS TARGET: balance TOTAL minutes, not just outfield minutes. A player
  // doing a half in goal already has that GK time banked, so their outfield
  // target is the shared total target minus their GK duty. This gives GKs real
  // field time without forcing them 5-10 minutes above everyone else.
  const averageTotalSecondsPerPlayer = playerData.length > 0
    ? (totalRemainingSeconds * teamSize) / playerData.length
    : 0;
  const isGkPlayer = (id: string) =>
    (includeStartingGkInRotation && id === gkOnPitch?.id) ||
    (halftimeGkIn ? id === halftimeGkIn.id : false);
  const gkDutySeconds = (id: string) => {
    let duty = 0;
    if (startingGkWillRotate && id === gkOnPitch?.id) {
      duty += Math.max(0, halfDurationSeconds - startElapsedSeconds);
    }
    if (halftimeGkIn && id === halftimeGkIn.id) {
      duty += halfDurationSeconds;
    }
    return duty;
  };
  // FAIRNESS RULE: every player's TOTAL minutes target (field + GK duty) is
  // equal. GKs do NOT get extra total minutes — that would mean less time for
  // outfielders. Instead, GKs get a tiebreaker priority bonus in the scheduler
  // (see scoring below) so when needs are equal, the GK is rotated on first,
  // landing them at "equal top" of the playing time list rather than below.
  const fieldTargetSeconds = (id: string) =>
    Math.max(0, averageTotalSecondsPerPlayer - gkDutySeconds(id));
  // Adjusted time for sorting: players above their personal target are picked
  // off first; players furthest below target are picked on first.
  const adjustedTime = (id: string) =>
    (playingTime.get(id) || 0) - fieldTargetSeconds(id);

  const canUseInOutfield = (player: Player, position?: PitchPosition) => {
    if (!position || position === "GK" || player.isInjured) return false;
    // A nominated half-game GK still needs fair total minutes, so allow them
    // to cover an outfield slot outside their goalkeeping half.
    if (player.id === gkOnPitch?.id || player.id === halftimeGkIn?.id) return true;
    if (player.assignedPositions?.length === 1 && player.assignedPositions.includes("GK")) return true;
    return !player.assignedPositions?.length || player.assignedPositions.includes(position);
  };

  const playerById = new Map(playerData.map(p => [p.id, p]));
  const fieldSlots = outfieldOnPitch.map(p => ({
    position: p.currentPitchPosition as PitchPosition,
    playerId: p.id,
  }));

  const currentFieldSeconds = new Map<string, number>();
  outfieldPlayers.forEach(p => currentFieldSeconds.set(p.id, p.minutesPlayed || 0));

  const totalExistingSeconds = playerData.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const sharedTotalTarget = playerData.length > 0
    ? (totalExistingSeconds + totalRemainingSeconds * teamSize) / playerData.length
    : 0;
  const rawFieldTargets = new Map<string, number>();
  outfieldPlayers.forEach(p => {
    // FAIRNESS: every player aims for the SAME total minutes (field + GK duty).
    // GKs already have GK time banked, so their outfield target is the shared
    // total minus their GK duty. They naturally play LESS outfield, not more —
    // landing them at equal total minutes alongside everyone else.
    const base = Math.max(0, sharedTotalTarget - (p.minutesPlayed || 0) - gkDutySeconds(p.id));
    rawFieldTargets.set(p.id, base);
  });
  const rawTargetTotal = Array.from(rawFieldTargets.values()).reduce((sum, value) => sum + value, 0);
  const fieldTargetScale = rawTargetTotal > 0 ? totalFieldSeconds / rawTargetTotal : 1;
  const targetFieldSeconds = (id: string) => (rawFieldTargets.get(id) || 0) * fieldTargetScale;

  const toPlanTime = (absoluteSeconds: number): { half: 1 | 2; time: number } => ({
    half: absoluteSeconds < halfDurationSeconds ? 1 : 2,
    time: absoluteSeconds < halfDurationSeconds ? absoluteSeconds : absoluteSeconds - halfDurationSeconds,
  });

  const startAbsoluteSeconds = startHalf === 1 ? clampedStartElapsed : halfDurationSeconds + clampedStartElapsed;
  const endAbsoluteSeconds = halfDurationSeconds * 2;
  // Cap subs per window, but do NOT under-schedule windows in minimal mode.
  // Minimal means fewer players swapped at once; it must still create enough
  // rotation points for every rotatable player to share bench time fairly.
  const benchSize = Math.max(1, outfieldOnBench.length);
  const maxSubEventsPerWindow = Math.max(
    1,
    Math.min(disableBatchSubs ? 1 : subsAtOnce, benchSize, fieldSlots.length)
  );
  // Rotation continuity: with multiple bench players, someone who has just been
  // brought on should not be the player removed at the very next rotation.
  // They re-enter the normal off-order after one further window has passed.
  let previousRotationPlayerInIds = new Set<string>();

  // QUEUE TRACKING (queue-first rotation with fairness override)
  // ------------------------------------------------------------
  // Players go on/off in FIFO order: oldest-waiting bench player goes on,
  // longest-on-pitch player goes off. Fairness only overrides queue order
  // when the projected end-of-game gap exceeds FAIRNESS_TOLERANCE_SECONDS.
  // A MIN_SHIFT_SECONDS guarantees no player is pulled too soon after coming on.
  const FAIRNESS_TOLERANCE_SECONDS = 60;
  const MIN_SHIFT_SECONDS = 180;
  // Position weight for ordering starters into the off-queue:
  // GK never rotates off via queue; defenders go first, then mids, then forwards.
  const positionRotationOrder = (pos: PitchPosition | undefined): number => {
    switch (pos) {
      case "GK": return 99;
      case "DEF": return 0;
      case "MID": return 1;
      case "FWD": return 2;
      default: return 3;
    }
  };
  // lastOnAt = absolute seconds when the player most recently entered the pitch.
  // Starters are seeded with offsets based on position so DEF rotate first.
  // Lower lastOnAt = been on longer = next off.
  const lastOnAt = new Map<string, number>();
  outfieldOnPitch.forEach(p => {
    const offset = positionRotationOrder(p.currentPitchPosition as PitchPosition);
    // Sub-second offsets keep starters ordered by position without affecting
    // shift-length math (which works in whole seconds).
    lastOnAt.set(p.id, startAbsoluteSeconds - 1000 + offset);
  });
  // lastOffAt = absolute seconds when the player most recently came off the pitch.
  // Bench players at start are all "waiting" since startAbsoluteSeconds.
  // Lower lastOffAt = been waiting longer = next on.
  const lastOffAt = new Map<string, number>();
  outfieldOnBench.forEach((p, idx) => {
    // Slight stagger by bench order so the first bench player goes on first.
    lastOffAt.set(p.id, startAbsoluteSeconds - 1000 + idx);
  });

  // FAIRNESS-DRIVEN WINDOW COUNT
  // ----------------------------
  // For perfectly equal minutes, each player spends T·B/N seconds on the bench
  // (T = remaining time, B = bench size, N = total rotatable players). One full
  // "cycle" rotates every player off exactly once and requires N sub-events.
  // With `subsAtOnce` swaps per window, a full cycle = N / subsAtOnce windows.
  //
  // Speed controls how many cycles we run (more cycles = shorter shifts, more
  // disruption, but identical fairness ceiling). All speeds aim for at least
  // ONE full cycle so every bench player gets equal time off.
  const baseCycleEvents = totalOutfieldPlayers; // one off-event per player
  // Cycles per speed: minimal=1 (longest shifts), balanced=1, fast=2 (shorter shifts)
  // Both minimal and balanced run a single full fairness cycle — they differ in
  // batch size (subsAtOnce), not in window count. Fast doubles rotations.
  let cycleMultiplier = rotationSpeed === 3 ? 2 : 1;
  // SPREAD CAP ESCALATION: when the user has set a tight max-spread, a single
  // cycle may not give bench players enough on-pitch time to converge. The
  // dominant residual spread comes from players "locked out" of part of the
  // game (e.g. half-game GKs) who need a precise number of outfield turns to
  // hit their share. Estimate that residual and add cycles until it fits.
  const maxGkLockoutSeconds = Math.max(
    0,
    ...outfieldPlayers.map(p => gkDutySeconds(p.id))
  );
  // Residual spread ≈ outfield need a locked-out player misses if we run too
  // few cycles. A locked-out player needs ~`shareOutfield` minutes; a single
  // cycle gives them at most one turn (~window length).
  const targetSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
  const estimatedResidualSpread = maxGkLockoutSeconds > 0
    ? Math.min(maxGkLockoutSeconds, halfDurationSeconds * 0.4)
    : 0;
  if (estimatedResidualSpread > targetSpreadSeconds) {
    cycleMultiplier = Math.min(
      6,
      Math.max(cycleMultiplier, Math.ceil(estimatedResidualSpread / targetSpreadSeconds) + 2)
    );
  }
  // Pick the smallest window count whose total off-events (W * subsAtOnce) is
  // a multiple of N players — this is the ONLY way to get exactly equal time.
  const desiredOffEvents = baseCycleEvents * cycleMultiplier;
  let targetWindowsTotal = Math.max(1, Math.ceil(desiredOffEvents / maxSubEventsPerWindow));
  // Snap upward until W * subsAtOnce is divisible by N (fairness divisibility).
  while ((targetWindowsTotal * maxSubEventsPerWindow) % totalOutfieldPlayers !== 0) {
    targetWindowsTotal++;
    // Safety: never exceed 2x the desired count
    if (targetWindowsTotal > Math.ceil(desiredOffEvents / maxSubEventsPerWindow) * 2 + totalOutfieldPlayers) break;
  }
  // Floor interval prevents churn but never overrides fairness windows. We
  // recompute as evenly-spaced windows across remaining time.
  const minIntervalFloor = rotationSpeed === 3 ? 90 : 120;
  const intervalFromWindows = totalRemainingSeconds / (targetWindowsTotal + 1);
  const maxIntervalSeconds = Math.max(minIntervalFloor, Math.floor(intervalFromWindows));
  const directEventTimes = new Set<number>();

  for (let t = startAbsoluteSeconds + maxIntervalSeconds; t < endAbsoluteSeconds - 45; t += maxIntervalSeconds) {
    if (t < halfDurationSeconds && halfDurationSeconds - t <= 45) continue;
    if (t > halfDurationSeconds && t - halfDurationSeconds <= 45) continue;
    directEventTimes.add(Math.floor(t));
  }
  if (startAbsoluteSeconds < halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn) {
    directEventTimes.add(halfDurationSeconds);
  }

  const sortedDirectEventTimes = Array.from(directEventTimes).sort((a, b) => a - b);

  const isAvailableForInterval = (player: Player, intervalStart: number, intervalEnd: number) => {
    if (player.isInjured) return false;
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id && intervalStart < halfDurationSeconds) return false;
    if (halftimeGkIn && player.id === halftimeGkIn.id && intervalEnd > halfDurationSeconds) return false;
    return true;
  };

  const remainingAvailabilitySeconds = (player: Player, intervalStart: number) => {
    const start = Math.max(intervalStart, startAbsoluteSeconds);
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id) {
      return Math.max(1, endAbsoluteSeconds - Math.max(start, halfDurationSeconds));
    }
    if (halftimeGkIn && player.id === halftimeGkIn.id) {
      return Math.max(1, halfDurationSeconds - Math.min(start, halfDurationSeconds));
    }
    return Math.max(1, endAbsoluteSeconds - start);
  };

  const addFieldTime = (elapsed: number) => {
    if (elapsed <= 0) return;
    fieldSlots.forEach(slot => {
      if (slot.playerId) {
        currentFieldSeconds.set(slot.playerId, (currentFieldSeconds.get(slot.playerId) || 0) + elapsed);
      }
    });
  };

  const choosePlayerForSlot = (
    position: PitchPosition,
    currentSlotPlayerId: string | null,
    usedIds: Set<string>,
    currentIds: Set<string>,
    intervalStart: number,
    intervalEnd: number
  ) => {
    const intervalLength = Math.max(0, intervalEnd - intervalStart);
    const candidates = outfieldPlayers.filter(player => {
      if (usedIds.has(player.id)) return false;
      if (!isAvailableForInterval(player, intervalStart, intervalEnd)) return false;
      if (!canUseInOutfield(player, position)) return false;
      // Avoid moving players between slots in the generated plan; only keep a
      // player in their current slot or bring someone on from the bench.
      if (currentIds.has(player.id) && player.id !== currentSlotPlayerId) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const aNeed = targetFieldSeconds(a.id) - (currentFieldSeconds.get(a.id) || 0);
      const bNeed = targetFieldSeconds(b.id) - (currentFieldSeconds.get(b.id) || 0);
      const aUrgency = aNeed / remainingAvailabilitySeconds(a, intervalStart);
      const bUrgency = bNeed / remainingAvailabilitySeconds(b, intervalStart);
      // Pure fairness ordering — no GK bonus. With correct targets, GKs
      // already need less outfield time and will naturally end at equal totals.
      const aScore = aUrgency * 1000 + aNeed * 0.01 - intervalLength + (a.id === currentSlotPlayerId ? 20 : 0);
      const bScore = bUrgency * 1000 + bNeed * 0.01 - intervalLength + (b.id === currentSlotPlayerId ? 20 : 0);
      return bScore - aScore;
    });

    return candidates[0] || null;
  };

  const applyFairRotationAt = (absoluteSeconds: number, nextAbsoluteSeconds: number, reservedSubEvents = 0) => {
    const maxChanges = Math.max(0, maxSubEventsPerWindow - reservedSubEvents);
    if (maxChanges === 0) {
      previousRotationPlayerInIds = new Set<string>();
      return;
    }

    const currentIds = new Set(fieldSlots.map(slot => slot.playerId).filter(Boolean) as string[]);

    // FAIRNESS-DRIVEN SELECTION (with queue tiebreakers + bounce-back guard)
    // -----------------------------------------------------------------------
    // 1. Bench order: by current playing time ASC (least-played first).
    //    Tiebreaker: lastOffAt ASC (longest waiting first).
    // 2. Pitch order: by current playing time DESC (most-played first).
    //    Tiebreaker: lastOnAt ASC (longest on first).
    // 3. MIN_SHIFT_SECONDS prevents pulling someone who just came on.
    // 4. Strict anti-bounce-back: never pull a player who entered in the
    //    immediately previous window.
    // 5. Only commit a swap if it actually reduces the gap between the two
    //    players' projected end-of-game minutes (avoids churn).
    const projectedFinalSeconds = (id: string) => {
      // If they stay in their current state for the rest of the game.
      const onPitchNow = currentIds.has(id);
      const remaining = endAbsoluteSeconds - absoluteSeconds;
      const accumulated = currentFieldSeconds.get(id) || 0;
      return accumulated + (onPitchNow ? remaining : 0);
    };

    // Each player's TOTAL minutes target = field + GK duty already received.
    // Sorting by deficit-against-target (rather than raw field minutes) means
    // GKs — who have minutes banked from goalkeeping — naturally rank lower in
    // the bench queue, ensuring everyone finishes at equal TOTAL minutes.
    const totalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = p?.minutesPlayed || 0;
      return Math.max(0, sharedTotalTarget - baseMinutes - gkDutySeconds(id));
    };
    const deficit = (id: string) => totalTarget(id) - (currentFieldSeconds.get(id) || 0);
    // Urgency = deficit / time remaining where the player is still available.
    // This makes a player with limited availability (e.g. 2H-GK only available
    // in H1 for outfield duty) escalate their priority as their window closes.
    const urgency = (p: Player) => {
      const remain = remainingAvailabilitySeconds(p, absoluteSeconds);
      return deficit(p.id) / Math.max(1, remain);
    };

    // QUEUE-FIRST with hard max-spread cap.
    // -----------------------------------------------------------------------
    // The cap is enforced on PROJECTED final minutes (= field minutes already
    // banked + minutes still to be played if we leave the player in their
    // current state). When the projected spread between the most-played and
    // least-played available players would exceed the user cap, we override
    // queue order and force the worst offenders to swap. Otherwise we keep
    // pure FIFO queue ordering for predictability.
    const maxSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
    // Escalation kicks in earlier than the hard cap so we have time to correct
    // before we'd actually breach it.
    // Use 40% of the cap so corrections start well before the breach.
    const escalationThreshold = Math.max(30, maxSpreadSeconds * 0.4);

    // Each player has a TARGET total (field + GK duty already received) equal
    // to the average across the squad. The "shortfall" we want to close is
    // (target − projected total). When the spread between shortfalls breaches
    // the cap, override queue order to prioritise the most-shortfall players.
    const totalProjected = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      return baseMinutes + gkDutySeconds(id) + projectedFinalSeconds(id);
    };
    const playerTotalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      return Math.max(baseMinutes + gkDutySeconds(id), sharedTotalTarget);
    };
    const shortfall = (id: string) => playerTotalTarget(id) - totalProjected(id);

    // Snapshot now so we can detect cap breaches.
    const projectionsNow = new Map<string, number>();
    const shortfallsNow = new Map<string, number>();
    outfieldPlayers.forEach(p => {
      projectionsNow.set(p.id, totalProjected(p.id));
      shortfallsNow.set(p.id, shortfall(p.id));
    });
    const shortfallVals = Array.from(shortfallsNow.values());
    const shortfallSpread = Math.max(...shortfallVals) - Math.min(...shortfallVals);
    const capBreached = shortfallSpread > escalationThreshold;

    const benchQueue = outfieldPlayers
      .filter(p => !currentIds.has(p.id))
      .filter(p => isAvailableForInterval(p, absoluteSeconds, nextAbsoluteSeconds))
      .sort((a, b) => {
        if (capBreached) {
          // Override: bring on the player with the largest shortfall first.
          const aS = shortfallsNow.get(a.id) ?? 0;
          const bS = shortfallsNow.get(b.id) ?? 0;
          if (Math.abs(aS - bS) > 15) return bS - aS;
        }
        // Default: pure FIFO queue order — longest-waiting bench player first.
        return (lastOffAt.get(a.id) ?? 0) - (lastOffAt.get(b.id) ?? 0);
      });

    const pitchSlotsWithMeta = fieldSlots
      .map((slot, index) => ({ slot, index, playerOut: slot.playerId ? playerById.get(slot.playerId) : undefined }))
      .filter(({ playerOut }) => !!playerOut);

    const usedSlotIndexes = new Set<number>();
    const usedInIds = new Set<string>();
    const selectedSubs: { slotIndex: number; playerOut: Player; playerIn: Player }[] = [];

    for (let bi = 0; bi < benchQueue.length && selectedSubs.length < maxChanges; bi++) {
      const playerIn = benchQueue[bi];
      if (usedInIds.has(playerIn.id)) continue;

      // Pitch candidates compatible with this incoming player.
      // When cap is breached: pull the highest projected total first.
      // Otherwise: queue order (longest currently-on-pitch first).
      const eligibleSlots = pitchSlotsWithMeta
        .filter(({ slot, index, playerOut }) =>
          !usedSlotIndexes.has(index) &&
          !!playerOut &&
          canUseInOutfield(playerIn, slot.position) &&
          absoluteSeconds - (lastOnAt.get(playerOut!.id) ?? 0) >= MIN_SHIFT_SECONDS &&
          !previousRotationPlayerInIds.has(playerOut!.id)
        )
        .sort((a, b) => {
          if (capBreached) {
            // Pull off the player with the SMALLEST shortfall (most over their fair share).
            const aS = shortfallsNow.get(a.playerOut!.id) ?? 0;
            const bS = shortfallsNow.get(b.playerOut!.id) ?? 0;
            if (Math.abs(aS - bS) > 15) return aS - bS;
          }
          // Default: queue order — longest currently-on-pitch first.
          return (lastOnAt.get(a.playerOut!.id) ?? 0) - (lastOnAt.get(b.playerOut!.id) ?? 0);
        });

      if (eligibleSlots.length === 0) continue;

      const chosenSlot = eligibleSlots[0];
      const playerOut = chosenSlot.playerOut!;

      // Only commit if the swap actually narrows the shortfall gap between
      // these two players. (Avoids churn when shortfalls are already balanced.)
      const inShortfall = shortfallsNow.get(playerIn.id) ?? 0;
      const outShortfall = shortfallsNow.get(playerOut.id) ?? 0;
      const gapBefore = inShortfall - outShortfall;
      if (gapBefore < 30 && !capBreached) {
        continue;
      }
      // Hard refusal: never make the spread worse (incoming player already above target).
      if (gapBefore < 0) continue;

      usedSlotIndexes.add(chosenSlot.index);
      usedInIds.add(playerIn.id);
      selectedSubs.push({ slotIndex: chosenSlot.index, playerOut, playerIn });
    }

    selectedSubs.forEach(({ slotIndex, playerOut, playerIn }) => {
      const { half, time } = toPlanTime(absoluteSeconds);
      plan.push({
        time,
        half,
        playerOut,
        playerIn,
        executed: false,
      });

      fieldSlots[slotIndex].playerId = playerIn.id;
      // Update queue trackers: outgoing player joins bench wait queue,
      // incoming player starts a fresh on-pitch shift.
      lastOffAt.set(playerOut.id, absoluteSeconds);
      lastOnAt.set(playerIn.id, absoluteSeconds);
    });

    previousRotationPlayerInIds = new Set(selectedSubs.map(sub => sub.playerIn.id));
  };

  let directLastTime = startAbsoluteSeconds;
  for (let i = 0; i < sortedDirectEventTimes.length; i++) {
    const eventTime = sortedDirectEventTimes[i];
    addFieldTime(eventTime - directLastTime);
    directLastTime = eventTime;

    let reservedSubEvents = 0;
    if (eventTime === halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: halftimeGkIn,
        executed: false,
      });
      reservedSubEvents = 1;
      fieldSlots.forEach(slot => {
        if (slot.playerId === halftimeGkIn.id) slot.playerId = null;
      });
      // Queue updates for the GK swap: starting GK becomes available for the
      // outfield bench queue (H2 onward), halftime GK is now on pitch as GK.
      lastOffAt.set(gkOnPitch.id, eventTime);
      lastOnAt.set(halftimeGkIn.id, eventTime);
    }

    const nextTime = sortedDirectEventTimes[i + 1] ?? endAbsoluteSeconds;
    applyFairRotationAt(eventTime, nextTime, reservedSubEvents);
  }
  addFieldTime(endAbsoluteSeconds - directLastTime);

  const getPlanAbsoluteSeconds = (sub: SubstitutionEvent) =>
    sub.half === 1 ? sub.time : halfDurationSeconds + sub.time;
  const isDirectHalftimeGkSwapSub = (sub: SubstitutionEvent) =>
    !!gkOnPitch && sub.half === 2 && sub.time === 0 && sub.playerOut.id === gkOnPitch.id;
  const fairPlayerIds = playerData.filter(p => !p.isInjured).map(p => p.id);

  const simulateFullPlan = (candidatePlan: SubstitutionEvent[]) => {
    const totals = new Map<string, number>();
    playerData.forEach(p => totals.set(p.id, p.minutesPlayed || 0));

    const onPitch = new Map<string, PitchPosition>();
    playersOnPitch.forEach(p => {
      if (p.currentPitchPosition) onPitch.set(p.id, p.currentPitchPosition);
    });

    // Track when each player most recently came onto the pitch (in absolute seconds).
    // Starters are seeded at startAbsoluteSeconds. Used to penalise short shifts
    // (a player taken off less than MIN_SHIFT_SECONDS_PENALTY after coming on).
    const cameOnAt = new Map<string, number>();
    playersOnPitch.forEach(p => cameOnAt.set(p.id, startAbsoluteSeconds));
    const MIN_SHIFT_SECONDS_PENALTY = 180;

    const ordered = candidatePlan
      .map((sub, index) => ({ sub, index, absoluteSeconds: getPlanAbsoluteSeconds(sub) }))
      .sort((a, b) => a.absoluteSeconds - b.absoluteSeconds);
    const snapshots: { index: number; before: Map<string, PitchPosition>; absoluteSeconds: number; nextAbsoluteSeconds: number }[] = [];
    let last = startAbsoluteSeconds;
    let valid = true;
    let bounceBackCount = 0;
    let shortShiftCount = 0;
    let currentWindowTime: number | null = null;
    let previousWindowPlayerIns = new Set<string>();
    let currentWindowPlayerIns = new Set<string>();

    ordered.forEach((entry, orderIndex) => {
      const elapsed = entry.absoluteSeconds - last;
      if (elapsed < 0) valid = false;
      if (elapsed > 0) {
        onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + elapsed));
      }

      if (currentWindowTime !== entry.absoluteSeconds) {
        previousWindowPlayerIns = currentWindowPlayerIns;
        currentWindowPlayerIns = new Set<string>();
        currentWindowTime = entry.absoluteSeconds;
      }

      if (benchSize > 1 && previousWindowPlayerIns.has(entry.sub.playerOut.id) && !isDirectHalftimeGkSwapSub(entry.sub)) {
        bounceBackCount++;
      }

      // Short-shift penalty: catches bounce-backs across more than one window.
      if (benchSize > 1 && !isDirectHalftimeGkSwapSub(entry.sub)) {
        const onSince = cameOnAt.get(entry.sub.playerOut.id);
        if (onSince !== undefined && entry.absoluteSeconds - onSince < MIN_SHIFT_SECONDS_PENALTY) {
          shortShiftCount++;
        }
      }

      snapshots.push({
        index: entry.index,
        before: new Map(onPitch),
        absoluteSeconds: entry.absoluteSeconds,
        nextAbsoluteSeconds: ordered[orderIndex + 1]?.absoluteSeconds ?? endAbsoluteSeconds,
      });

      const outPosition = onPitch.get(entry.sub.playerOut.id);
      if (!outPosition || onPitch.has(entry.sub.playerIn.id)) valid = false;

      onPitch.delete(entry.sub.playerOut.id);
      cameOnAt.delete(entry.sub.playerOut.id);
      if (entry.sub.positionSwap) {
        const swapFromPosition = onPitch.get(entry.sub.positionSwap.player.id);
        if (!swapFromPosition) valid = false;
        if (swapFromPosition) onPitch.set(entry.sub.playerIn.id, swapFromPosition);
        onPitch.set(entry.sub.positionSwap.player.id, outPosition || entry.sub.positionSwap.toPosition);
      } else if (outPosition) {
        onPitch.set(entry.sub.playerIn.id, outPosition);
      }
      cameOnAt.set(entry.sub.playerIn.id, entry.absoluteSeconds);

      currentWindowPlayerIns.add(entry.sub.playerIn.id);

      last = entry.absoluteSeconds;
    });

    const remaining = endAbsoluteSeconds - last;
    if (remaining > 0) {
      onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + remaining));
    }

    return { totals, snapshots, valid, bounceBackCount, shortShiftCount };
  };

  const fairnessObjective = (totals: Map<string, number>, bounceBackCount = 0, shortShiftCount = 0) => {
    const values = fairPlayerIds.map(id => totals.get(id) || 0);
    if (values.length < 2) return 0;
    const spread = Math.max(...values) - Math.min(...values);
    return spread * 1000 + bounceBackCount * 10_000_000 + shortShiftCount * 5_000_000;
  };

  // Iterative fairness optimizer. Each pass tries every legal single-sub
  // identity replacement at every snapshot and keeps the edit that most
  // reduces (spread × 1000 + GK shortfall). Runs until no improvement.
  const MAX_OPTIMIZER_ITERATIONS = 120;
  for (let iter = 0; iter < MAX_OPTIMIZER_ITERATIONS; iter++) {
    const currentSim = simulateFullPlan(plan);
    if (!currentSim.valid) break;
    const currentScore = fairnessObjective(currentSim.totals, currentSim.bounceBackCount, currentSim.shortShiftCount);
    if (currentScore === 0) break;
    let bestEdit: { index: number; replacement: SubstitutionEvent; score: number } | null = null;

    for (const snapshot of currentSim.snapshots) {
      const original = plan[snapshot.index];
      if (!original || isDirectHalftimeGkSwapSub(original)) continue;

      const incomingCandidates = playerData.filter(player =>
        !snapshot.before.has(player.id) &&
        isAvailableForInterval(player, snapshot.absoluteSeconds, snapshot.nextAbsoluteSeconds)
      );

      for (const [outId, outPosition] of snapshot.before.entries()) {
        if (outPosition === "GK") continue;
        const playerOut = playerById.get(outId);
        if (!playerOut) continue;

        for (const playerIn of incomingCandidates) {
          if (!canUseInOutfield(playerIn, outPosition)) continue;
          if (playerOut.id === original.playerOut.id && playerIn.id === original.playerIn.id && !original.positionSwap) continue;

          const replacement: SubstitutionEvent = {
            ...original,
            playerOut,
            playerIn,
            positionSwap: undefined,
          };

          plan[snapshot.index] = replacement;
          const trial = simulateFullPlan(plan);
          const score = trial.valid ? fairnessObjective(trial.totals, trial.bounceBackCount, trial.shortShiftCount) : Number.POSITIVE_INFINITY;
          plan[snapshot.index] = original;

          // Accept any strict improvement (no slack) so the optimizer can keep
          // tightening the spread until truly optimal.
          if (trial.valid && score < (bestEdit?.score ?? currentScore)) {
            bestEdit = { index: snapshot.index, replacement, score };
          }
        }
      }
    }

    if (!bestEdit || bestEdit.score >= currentScore) break;
    plan[bestEdit.index] = bestEdit.replacement;
  }

  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    if (a.time !== b.time) return a.time - b.time;
    const aIsGkSwap = !!gkOnPitch && a.half === 2 && a.time === 0 && a.playerOut.id === gkOnPitch.id;
    const bIsGkSwap = !!gkOnPitch && b.half === 2 && b.time === 0 && b.playerOut.id === gkOnPitch.id;
    if (aIsGkSwap !== bIsGkSwap) return aIsGkSwap ? -1 : 1;
    return 0;
  });

  return plan;

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
    // Prefer the H2 GK we predicted upfront (and gave the priority bonus to)
    // so the simulation stays consistent. Fall back to least-played GK-eligible
    // bench player only if none was predicted.
    const gkReplacementPlayer = halftimeGkIn || (() => {
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
  
  const isHalftimeGkSwapSub = (sub: SubstitutionEvent) =>
    !!gkOnPitch && sub.half === 2 && sub.time === 0 && sub.playerOut.id === gkOnPitch.id;

  const sortPlan = () => {
    plan.sort((a, b) => {
      if (a.half !== b.half) return a.half - b.half;
      if (a.time !== b.time) return a.time - b.time;
      // The GK change must happen before any other halftime subs so the H2 GK
      // is removed from the outfield rotation before normal subs are applied.
      if (isHalftimeGkSwapSub(a) !== isHalftimeGkSwapSub(b)) {
        return isHalftimeGkSwapSub(a) ? -1 : 1;
      }
      return 0;
    });
  };

  sortPlan();

  type SimulationSnapshot = {
    index: number;
    sub: SubstitutionEvent;
    before: Map<string, PitchPosition>;
  };

  const canPlayPosition = (player: Player, position?: PitchPosition) =>
    !!position && (!player.assignedPositions?.length || player.assignedPositions.includes(position));

  const simulateOutfieldPlan = (candidatePlan: SubstitutionEvent[]) => {
    const t = new Map<string, number>();
    outfieldPlayers.forEach(p => t.set(p.id, p.minutesPlayed || 0));

    const onP = new Map<string, PitchPosition>();
    outfieldOnPitch.forEach(p => onP.set(p.id, p.currentPitchPosition as PitchPosition));

    const snapshots: SimulationSnapshot[] = [];
    let valid = true;
    let lt = startElapsedSeconds;
    let lh: 1 | 2 = startHalf;

    candidatePlan.forEach((sub, index) => {
      const elapsed = sub.half === lh
        ? sub.time - lt
        : (halfDurationSeconds - lt) + sub.time;

      if (elapsed < 0) valid = false;
      if (elapsed > 0) {
        onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + elapsed));
      }

      lt = sub.time;
      lh = sub.half;
      snapshots.push({ index, sub, before: new Map(onP) });

      if (isHalftimeGkSwapSub(sub)) {
        // This is a goalkeeping change, not an outfield substitution. If the
        // incoming GK was playing outfield in H1, remove them from field play.
        onP.delete(sub.playerIn.id);
        return;
      }

      const outPos = onP.get(sub.playerOut.id);
      if (!outPos || onP.has(sub.playerIn.id)) {
        valid = false;
      }

      onP.delete(sub.playerOut.id);
      if (sub.positionSwap) {
        const swapFromPos = onP.get(sub.positionSwap.player.id);
        if (!swapFromPos || !canPlayPosition(sub.playerIn, swapFromPos) || !canPlayPosition(sub.positionSwap.player, outPos)) {
          valid = false;
        }
        if (swapFromPos) onP.set(sub.playerIn.id, swapFromPos);
        if (outPos) onP.set(sub.positionSwap.player.id, outPos);
      } else if (outPos) {
        if (!canPlayPosition(sub.playerIn, outPos)) valid = false;
        onP.set(sub.playerIn.id, outPos);
      }
    });

    const endE = halfDurationSeconds - lt;
    if (endE > 0) onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + endE));
    if (lh === 1) onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + halfDurationSeconds));

    return { times: t, snapshots, valid };
  };

  const totalProjectedSeconds = (times: Map<string, number>, id: string) =>
    (times.get(id) || 0) + gkDutySeconds(id);

  // ITERATIVE FAIRNESS PASS: make legal, state-aware edits only. The previous
  // pass could miss cases where the overplayed player never appeared as a
  // matching `playerIn`/`playerOut`. Here we inspect the actual pitch state at
  // each sub window and replace that window with `overplayed off, underplayed on`.
  const fairnessTargets = outfieldPlayers;
  const FAIRNESS_TOLERANCE = 30; // avoids rounded forecasts still showing a multi-minute gap
  const MAX_REBALANCE_ITERATIONS = 24;

  const fairnessSpread = (times: Map<string, number>) => {
    const values = fairnessTargets.map(p => totalProjectedSeconds(times, p.id));
    if (values.length < 2) return 0;
    return Math.max(...values) - Math.min(...values);
  };

  for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
    const sim = simulateOutfieldPlan(plan);
    const ftimes = fairnessTargets.map(p => ({ id: p.id, t: totalProjectedSeconds(sim.times, p.id) }));
    if (ftimes.length < 2) break;

    ftimes.sort((a, b) => b.t - a.t);
    const over = ftimes[0];
    const under = ftimes[ftimes.length - 1];
    const currentSpread = over.t - under.t;
    if (currentSpread <= FAIRNESS_TOLERANCE) break;

    const overPlayer = getPlayer(over.id);
    const underPlayer = getPlayer(under.id);
    if (!overPlayer || !underPlayer) break;

    let bestEdit: { index: number; replacement: SubstitutionEvent; spread: number } | null = null;

    for (const snapshot of sim.snapshots) {
      const sub = plan[snapshot.index];
      if (!sub || isHalftimeGkSwapSub(sub)) continue;
      if (!snapshot.before.has(over.id) || snapshot.before.has(under.id)) continue;

      const overPosition = snapshot.before.get(over.id);
      if (!canPlayPosition(underPlayer, overPosition)) continue;

      const replacement: SubstitutionEvent = {
        ...sub,
        playerOut: overPlayer,
        playerIn: underPlayer,
        positionSwap: undefined,
      };

      const original = plan[snapshot.index];
      plan[snapshot.index] = replacement;
      const trial = simulateOutfieldPlan(plan);
      const spread = trial.valid ? fairnessSpread(trial.times) : currentSpread;
      plan[snapshot.index] = original;

      if (trial.valid && spread < (bestEdit?.spread ?? currentSpread)) {
        bestEdit = { index: snapshot.index, replacement, spread };
      }
    }

    if (!bestEdit) break;
    plan[bestEdit.index] = bestEdit.replacement;
  }

  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
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
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5
): SubstitutionEvent[] {
  const teamAPlayers = players.filter(p => p.teamSide === "a");
  const teamBPlayers = players.filter(p => p.teamSide === "b");
  
  const planA = teamAPlayers.length > 0
    ? createSubPlan(teamAPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, preferredSecondHalfGkId, maxSpreadMinutes)
    : [];
  
  const planB = teamBPlayers.length > 0
    ? createSubPlan(teamBPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, undefined, maxSpreadMinutes)
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
  maxSpreadMinutes = 5,
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
  maxSpreadMinutes?: number;
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
      return createMiniLeagueSubPlan(allPlayers, teamSize, halfDurationSeconds, rotationSpeed!, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId, maxSpreadMinutes);
    }
    return createSubPlan(allPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId, maxSpreadMinutes);
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
  maxSpreadMinutes = 5,
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
                maxSpreadMinutes={maxSpreadMinutes}
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
