/**
 * useAutoSubs — centralizes auto-sub plan state & handlers extracted from PitchBoard.
 *
 * Manages:
 *  • plan state (autoSubPlan, autoSubActive, autoSubPaused)
 *  • pending sub dialog state (pendingAutoSub, pendingBatchSubs, subConfirmDialogOpen)
 *  • locked players
 *  • plan lifecycle: start, cancel, pause/resume, skip-next, execute-now, regenerate
 *  • confirm / skip handlers (with recalculation, validation, undo)
 *  • due-sub detection (called from timer update)
 */

import { useState, useRef, useCallback, useReducer, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Player, SubstitutionEvent, TeamSize } from "@/components/pitch/types";
import type { GameTimerRef } from "@/components/pitch/GameTimer";
import { playSubAlertBeep } from "@/components/pitch/GameTimer";
import {
  getSubKey,
  executeSubsOnPlayers,
  markSubsExecuted,
  calculateSubDelay,
  getDueSubGroups,
  findRelevantNextSub,
} from "@/components/pitch/autoSubHelpers";
import {
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan,
} from "@/components/pitch/pitchStateUtils";
import { triggerPitchCheck } from "@/lib/triggerPitchCheck";
import {
  autoSubReducer,
  initialAutoSubState,
  type AutoSubState,
} from "@/components/pitch/autoSub/autoSubReducer";

export interface UseAutoSubsOptions {
  /** Initial plan from saved state */
  initialPlan?: SubstitutionEvent[];
  /** Initial active flag from saved state */
  initialActive?: boolean;
  /** Initial paused flag from saved state */
  initialPaused?: boolean;
  /** Ref to the game timer component */
  gameTimerRef: React.RefObject<GameTimerRef | null>;
  /** Current players getter (ref-based for stable identity) */
  playersRef: React.MutableRefObject<Player[]>;
  /** Setter to update players in PitchBoard */
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  /** Current team size */
  teamSize: TeamSize;
  /** Whether GK rotation at halftime is enabled */
  rotateGkAtHalftime: boolean;
  /** Push to undo history before making changes (ref to avoid hook ordering issues) */
  pushToUndoHistoryRef: React.MutableRefObject<((description: string, snapshot: Player[]) => void) | null>;
  /** Run the sub animation effect (ref to avoid hook ordering issues) */
  runSubAnimationRef: React.MutableRefObject<((playerOutId: string, playerInId: string, swapPlayerId?: string) => void) | null>;
}

export function useAutoSubs({
  initialPlan = [],
  initialActive = false,
  initialPaused = false,
  gameTimerRef,
  playersRef,
  setPlayers,
  teamSize,
  rotateGkAtHalftime,
  pushToUndoHistoryRef,
  runSubAnimationRef,
}: UseAutoSubsOptions) {
  const { toast } = useToast();

  // ── Core state ──────────────────────────────────────────
  const [autoSubPlan, setAutoSubPlan] = useState<SubstitutionEvent[]>(initialPlan);
  const [autoSubActive, setAutoSubActive] = useState(initialActive);
  const [autoSubPaused, setAutoSubPaused] = useState(initialPaused);
  const [lockedPlayerIds, setLockedPlayerIds] = useState<Set<string>>(new Set());

  // ── Dialog state ────────────────────────────────────────
  const [pendingAutoSub, setPendingAutoSub] = useState<SubstitutionEvent | null>(null);
  const [pendingBatchSubs, setPendingBatchSubs] = useState<SubstitutionEvent[]>([]);
  const [subConfirmDialogOpen, setSubConfirmDialogOpen] = useState(false);

  // ── Sub-due highlighting ────────────────────────────────
  const [subDuePlayerIds, setSubDuePlayerIds] = useState<Set<string>>(new Set());
  const subDueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Next-sub countdown info ─────────────────────────────
  const [nextSubInfo, setNextSubInfo] = useState<{
    playerInId: string;
    playerOutId: string;
    countdown: string;
  } | null>(null);

  // ── Internal refs ───────────────────────────────────────
  const planActivationTimeRef = useRef<{ seconds: number; half: 1 | 2 } | null>(null);
  const skipCooldownRef = useRef<number>(0);
  const regeneratePlanRef = useRef<(() => void) | null>(null);

  // ── Safeguard: prevent recalculation from wiping plan ──

  const shouldRecalculateAfterSkip = useCallback(
    (
      skippedSubs: SubstitutionEvent[],
      currentElapsed: number,
      half: 1 | 2,
      halfDurationSeconds: number
    ) => skippedSubs.some(sub => calculateSubDelay(sub, currentElapsed, half, halfDurationSeconds) > 30),
    []
  );

  /**
   * If recalculation returns fewer subs than expected (e.g. due to threshold edge cases),
   * fall back to the existing unexecuted plan (minus skipped subs) with validated references.
   */
  const safeRecalculate = useCallback(
    (
      players: Player[],
      halfDurationSeconds: number,
      currentElapsed: number,
      half: 1 | 2,
      skippedSub: SubstitutionEvent,
      existingUnexecuted: SubstitutionEvent[]
    ): SubstitutionEvent[] => {
      const recalculated = recalculateRemainingPlan(
        players,
        parseInt(teamSize),
        halfDurationSeconds,
        currentElapsed,
        half,
        skippedSub,
        rotateGkAtHalftime
      );

      // If recalculation shrinks the remaining plan, preserve the existing schedule.
      // Skipping a single sub should not collapse all future subs.
      if (existingUnexecuted.length > 0 && recalculated.length < existingUnexecuted.length) {
        console.warn("[AutoSub] Recalculation shortened remaining plan — preserving existing plan", {
          recalculated: recalculated.length,
          existing: existingUnexecuted.length,
        });
        return existingUnexecuted;
      }

      if (recalculated.length === 0 && existingUnexecuted.length > 0) {
        const benchPlayers = players.filter(p => p.position === null && !p.isInjured);
        if (benchPlayers.length > 0) {
          console.warn("[AutoSub] Recalculation returned empty but bench players remain — preserving existing plan");
          return existingUnexecuted;
        }
      }

      return recalculated;
    },
    [teamSize, rotateGkAtHalftime]
  );

  // ── Plan lifecycle ──────────────────────────────────────

  const handleStartAutoSubPlan = useCallback((plan: SubstitutionEvent[]) => {
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;
    planActivationTimeRef.current = { seconds: currentElapsed, half: currentHalf };
    setAutoSubPlan(plan);
    setAutoSubActive(true);
    toast({ title: "Auto-sub plan started", description: `${plan.length} substitutions scheduled` });
  }, [toast, gameTimerRef]);

  const handleCancelAutoSubPlan = useCallback(() => {
    setAutoSubPlan([]);
    setAutoSubActive(false);
    setAutoSubPaused(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubConfirmDialogOpen(false);
    setNextSubInfo(null);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) {
      clearTimeout(subDueTimerRef.current);
      subDueTimerRef.current = null;
    }
    planActivationTimeRef.current = null;
    toast({ title: "Auto-sub plan cancelled" });
  }, [toast]);

  const handleTogglePauseAutoSub = useCallback(() => {
    setAutoSubPaused(prev => {
      const newPaused = !prev;
      toast({
        title: newPaused ? "Auto-subs paused" : "Auto-subs resumed",
        description: newPaused
          ? "Sub alerts will not trigger until resumed"
          : "Sub alerts will trigger when due",
      });
      return newPaused;
    });
  }, [toast]);

  const handleToggleLockPlayer = useCallback((playerId: string) => {
    setLockedPlayerIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  // ── Skip next sub ──────────────────────────────────────

  const handleSkipNextSub = useCallback(() => {
    const players = playersRef.current;
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const nextSub = findRelevantNextSub(remainingSubs, half, currentElapsed, halfDurationSeconds);
    if (!nextSub) return;

    const skippedKeys = [getSubKey(nextSub)];
    const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);

    const existingUnexecuted = updatedPlan.filter(s => !s.executed);
    const shouldRecalculate = shouldRecalculateAfterSkip(
      [nextSub],
      currentElapsed,
      half,
      halfDurationSeconds
    );
    const recalculated = shouldRecalculate
      ? safeRecalculate(
          players,
          halfDurationSeconds,
          currentElapsed,
          half,
          nextSub,
          existingUnexecuted
        )
      : existingUnexecuted;

    const executedSubs = updatedPlan.filter(s => s.executed);
    const finalPlan = validateAndFixRemainingPlan([...executedSubs, ...recalculated], players);
    const remainingCount = finalPlan.filter(sub => !sub.executed).length;
    setAutoSubPlan(finalPlan);

    toast({
      title: shouldRecalculate ? "Substitution skipped & plan recalculated" : "Substitution skipped",
      description:
        remainingCount > 0
          ? `${remainingCount} substitution${remainingCount === 1 ? "" : "s"} remaining`
          : "No more planned substitutions",
    });
    skipCooldownRef.current = Date.now();
  }, [autoSubPlan, playersRef, safeRecalculate, shouldRecalculateAfterSkip, toast, gameTimerRef]);

  // ── Execute now ─────────────────────────────────────────

  const handleExecuteNow = useCallback(() => {
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const nextSub = findRelevantNextSub(remainingSubs, half, currentElapsed, halfDurationSeconds);
    if (!nextSub) return;

    const batchSubs = remainingSubs.filter(
      s => s.half === nextSub.half && s.time === nextSub.time && s !== nextSub
    );

    setPendingAutoSub(nextSub);
    setPendingBatchSubs(batchSubs);
    setSubConfirmDialogOpen(true);

    const playerOutName = nextSub.playerOut.name || `#${nextSub.playerOut.number}`;
    const playerInName = nextSub.playerIn.name || `#${nextSub.playerIn.number}`;
    const msg =
      batchSubs.length > 0
        ? `Time for ${batchSubs.length + 1} substitutions`
        : `Execute now: ${playerOutName} ➜ ${playerInName}`;
    playSubAlertBeep(msg);
  }, [autoSubPlan, gameTimerRef]);

  // ── Regenerate plan ─────────────────────────────────────

  const handleRegeneratePlan = useCallback(() => {
    const players = playersRef.current;
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;

    const dummySub: SubstitutionEvent = {
      time: currentElapsed,
      half,
      playerOut: players[0],
      playerIn: players[0],
      executed: true,
    };

    const recalculated = recalculateRemainingPlan(
      players,
      parseInt(teamSize),
      halfDurationSeconds,
      currentElapsed,
      half,
      dummySub,
      rotateGkAtHalftime
    );

    const currentRemainingSignature = autoSubPlan
      .filter(s => !s.executed)
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");
    const recalculatedSignature = recalculated
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");
    const isUnchanged = currentRemainingSignature === recalculatedSignature;

    const executedSubs = autoSubPlan.filter(s => s.executed);
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    // Safety guard: don't let regeneration wipe remaining plan
    if (recalculated.length > 0 || remainingSubs.length === 0) {
      setAutoSubPlan([...executedSubs, ...recalculated]);
    } else {
      const benchPlayers = players.filter(p => p.position === null && !p.isInjured);
      if (benchPlayers.length > 0) {
        console.warn("[AutoSub] Regeneration returned empty but bench players remain — preserving existing plan");
        // Keep existing plan unchanged
      } else {
        setAutoSubPlan([...executedSubs, ...recalculated]);
      }
    }
    toast({
      title: isUnchanged ? "Plan unchanged" : "Plan regenerated",
      description: isUnchanged
        ? "No better alternatives available right now"
        : `${recalculated.length} substitutions scheduled`,
    });
  }, [autoSubPlan, playersRef, teamSize, toast, gameTimerRef, rotateGkAtHalftime]);

  // Keep ref in sync
  regeneratePlanRef.current = handleRegeneratePlan;

  // ── Confirm pending sub ─────────────────────────────────

  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    const players = playersRef.current;

    // Guard: already executed/skipped
    const matchingSub = autoSubPlan.find(
      s =>
        s.playerOut.id === pendingAutoSub.playerOut.id &&
        s.time === pendingAutoSub.time &&
        s.half === pendingAutoSub.half
    );
    if (matchingSub?.executed || matchingSub?.skipped) {
      toast({
        title: "Substitution expired",
        description: "This sub was already skipped — a newer one is due",
        variant: "destructive",
      });
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      setSubDuePlayerIds(new Set());
      return;
    }

    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];

    // Guard: validate player positions before executing
    // If playerOut is already off pitch or playerIn is already on pitch,
    // the sub is stale — auto-skip it instead of showing an error
    const staleSubs = allPendingSubs.filter(sub => {
      const currentOut = players.find(p => p.id === sub.playerOut.id);
      const currentIn = players.find(p => p.id === sub.playerIn.id);
      return !currentOut?.position || (currentIn && currentIn.position !== null);
    });

    if (staleSubs.length === allPendingSubs.length) {
      // ALL subs are stale — skip them all gracefully
      const skippedKeys = allPendingSubs.map(s => getSubKey(s));
      const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);
      setAutoSubPlan(validateAndFixRemainingPlan(updatedPlan, players));
      toast({
        title: "Substitution expired",
        description: "Players have already moved — sub auto-skipped",
      });
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      setSubDuePlayerIds(new Set());
      if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      return;
    }

    // Filter out any stale subs from the batch, keep valid ones
    const validSubs = allPendingSubs.filter(sub => {
      const currentOut = players.find(p => p.id === sub.playerOut.id);
      const currentIn = players.find(p => p.id === sub.playerIn.id);
      return currentOut?.position && (!currentIn || currentIn.position === null);
    });

    // Push undo
    const subDescription =
      validSubs.length > 1
        ? `Batch sub: ${validSubs.length} substitutions`
        : `Auto-sub: ${validSubs[0].playerIn.name} for ${validSubs[0].playerOut.name}`;
    pushToUndoHistoryRef.current?.(subDescription, players);

    // Execute subs using shared helper
    const { updatedPlayers, executedSubKeys, successCount } = executeSubsOnPlayers(validSubs, players);

    // Animation — only if the primary sub was among valid ones
    if (validSubs.some(s => s.playerOut.id === pendingAutoSub.playerOut.id)) {
      const primarySwapPlayer = pendingAutoSub.positionSwap?.player?.id;
      runSubAnimationRef.current?.(pendingAutoSub.playerOut.id, pendingAutoSub.playerIn.id, primarySwapPlayer);
    }

    // Mark executed (include any stale subs that were filtered out)
    const staleSubKeys = staleSubs.map(s => getSubKey(s));
    let finalPlan = markSubsExecuted(autoSubPlan, [...executedSubKeys, ...staleSubKeys], false);
    // Mark stale ones as skipped
    if (staleSubKeys.length > 0) {
      finalPlan = markSubsExecuted(finalPlan, staleSubKeys, true);
    }

    // Recalculate if significantly late, early, or halftime sub (positions may have changed)
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const remainingSubs = finalPlan.filter(sub => !sub.executed);

    if (remainingSubs.length > 0) {
      const delaySeconds = calculateSubDelay(
        pendingAutoSub,
        currentElapsed,
        half as 1 | 2,
        halfDurationSeconds
      );
      // Also detect early execution: sub was scheduled later than current time
      const scheduledTime = pendingAutoSub.time;
      const earlyBySeconds = pendingAutoSub.half === (half as 1 | 2)
        ? Math.max(0, scheduledTime - currentElapsed)
        : 0;
      // Late recalc rule: only recalc if the NEXT scheduled sub's time has
      // already passed. Tapping a sub a bit late within its own window
      // shouldn't redistribute anything — we only redistribute when the delay
      // genuinely eats into the next sub's slot.
      const nextScheduled = remainingSubs
        .slice()
        .sort((a, b) => {
          if (a.half !== b.half) return a.half - b.half;
          return a.time - b.time;
        })[0];
      const currentTotalSeconds = (half as 1 | 2) === 1
        ? currentElapsed
        : halfDurationSeconds + currentElapsed;
      const nextTotalSeconds = nextScheduled
        ? (nextScheduled.half === 1 ? nextScheduled.time : halfDurationSeconds + nextScheduled.time)
        : null;
      const isSignificantlyEarly = earlyBySeconds > 30;
      const isSignificantlyLate =
        delaySeconds > 0 && nextTotalSeconds !== null && currentTotalSeconds >= nextTotalSeconds;

      // Always recalculate after halftime subs — player positions change at the break
      // and the remaining plan references pre-halftime positions, causing cascade skips.
      const isHalftimeSub = pendingAutoSub.half === 2 && pendingAutoSub.time === 0;


      if (isSignificantlyLate || isSignificantlyEarly || isHalftimeSub) {
        const executedPlan = finalPlan.filter(sub => sub.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          halfDurationSeconds,
          currentElapsed,
          half as 1 | 2,
          { ...pendingAutoSub, executed: true },
          rotateGkAtHalftime
        );
        // Use safeRecalculate logic: don't let recalculation wipe the plan
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedPlan, ...recalculated];
        } else {
          // Preserve existing remaining subs if recalculation returns empty
          const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[AutoSub] Halftime/late recalculation returned empty — preserving remaining plan");
            finalPlan = [...executedPlan, ...remainingSubs];
          } else {
            finalPlan = [...executedPlan, ...recalculated];
          }
        }
      }
    }

    finalPlan = validateAndFixRemainingPlan(finalPlan, updatedPlayers);
    
    // Safety net: if validation cascade-skipped all remaining subs but bench players exist,
    // force a full recalculation to regenerate valid subs for the rest of the match.
    const remainingAfterValidation = finalPlan.filter(sub => !sub.executed);
    const benchAfterSub = updatedPlayers.filter(p => p.position === null && !p.isInjured);
    if (remainingAfterValidation.length === 0 && remainingSubs.length > 0 && benchAfterSub.length > 0) {
      console.warn("[AutoSub] Validation wiped all remaining subs — forcing recalculation");
      const executedPlan = finalPlan.filter(sub => sub.executed);
      const rescued = recalculateRemainingPlan(
        updatedPlayers,
        parseInt(teamSize),
        halfDurationSeconds,
        currentElapsed,
        half as 1 | 2,
        { ...pendingAutoSub, executed: true },
        rotateGkAtHalftime
      );
      if (rescued.length > 0) {
        finalPlan = validateAndFixRemainingPlan([...executedPlan, ...rescued], updatedPlayers);
      }
    }
    setAutoSubPlan(finalPlan);
    setPlayers(updatedPlayers);

    const staleCount = staleSubs.length;
    const toastDescription =
      validSubs.length > 1
        ? `${successCount} substitutions made${staleCount > 0 ? `, ${staleCount} expired` : ''}`
        : successCount > 0
          ? `${validSubs[0].playerIn.name} replaces ${validSubs[0].playerOut.name}`
          : 'Sub expired — players already moved';
    toast({
      title: successCount > 0
        ? (validSubs.length > 1 ? "Substitutions made" : "Substitution made")
        : "Substitution expired",
      description: toastDescription,
    });

    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);

    if (finalPlan.filter(sub => !sub.executed).length === 0) {
      // Keep autoSubActive true so GlobalSubMonitor can still track the game
      // (e.g. for game-finished detection). It will be cleared on game reset.
      toast({ title: "All substitutions complete" });
    }
  }, [
    pendingAutoSub,
    pendingBatchSubs,
    autoSubPlan,
    playersRef,
    teamSize,
    rotateGkAtHalftime,
    toast,
    pushToUndoHistoryRef,
    runSubAnimationRef,
    setPlayers,
    gameTimerRef,
  ]);

  // ── Skip pending sub ────────────────────────────────────

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    const players = playersRef.current;

    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    const skippedKeys = allPendingSubs.map(s => getSubKey(s));
    const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);

    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const existingUnexecuted = updatedPlan.filter(s => !s.executed);
    const shouldRecalculate = shouldRecalculateAfterSkip(
      allPendingSubs,
      currentElapsed,
      half,
      halfDurationSeconds
    ) || (pendingAutoSub.half === 2 && pendingAutoSub.time === 0); // Always recalculate halftime skips
    const recalculated = shouldRecalculate
      ? safeRecalculate(
          players,
          halfDurationSeconds,
          currentElapsed,
          half,
          pendingAutoSub,
          existingUnexecuted
        )
      : existingUnexecuted;

    const executedSubs = updatedPlan.filter(s => s.executed);
    const finalPlan = validateAndFixRemainingPlan([...executedSubs, ...recalculated], players);
    const remainingCount = finalPlan.filter(sub => !sub.executed).length;
    setAutoSubPlan(finalPlan);

    toast({
      title:
        allPendingSubs.length > 1
          ? shouldRecalculate
            ? `${allPendingSubs.length} subs skipped & plan recalculated`
            : `${allPendingSubs.length} subs skipped`
          : shouldRecalculate
            ? "Sub skipped & plan recalculated"
            : "Sub skipped",
      description:
        remainingCount > 0
          ? `${remainingCount} substitution${remainingCount === 1 ? "" : "s"} remaining`
          : "No more planned substitutions",
    });

    skipCooldownRef.current = Date.now();
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
  }, [pendingAutoSub, pendingBatchSubs, autoSubPlan, playersRef, safeRecalculate, shouldRecalculateAfterSkip, toast, gameTimerRef]);

  // ── Due-sub detection (called from handleTimerUpdate) ───

  /**
   * Check for due subs and open the confirm dialog if needed.
   * Called on every timer tick from the parent's handleTimerUpdate.
   * Returns true if a sub was triggered (so parent can skip redundant work).
   */
  const checkForDueSubs = useCallback(
    (elapsedSeconds: number, currentHalf: 1 | 2) => {
      if (!autoSubActive || autoSubPlan.length === 0 || autoSubPaused) return false;
      if (gameTimerRef.current?.isGameFinished()) return false;
      if (!gameTimerRef.current?.isRunning?.()) return false;
      if (Date.now() - skipCooldownRef.current < 3000) return false;

      const activationTime = planActivationTimeRef.current;

      const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
      const halfDurationSeconds = minsPerHalf * 60;
      const eligibleSubs = autoSubPlan.filter(sub => {
        if (sub.executed) return false;
        if (activationTime && sub.half === activationTime.half && sub.time < activationTime.seconds) return false;
        if (activationTime && sub.half < activationTime.half) return false;
        return true;
      });

      const { latestDueSubs, olderDueSubs: olderSubs } = getDueSubGroups(
        eligibleSubs,
        currentHalf,
        elapsedSeconds,
        halfDurationSeconds
      );

      if (latestDueSubs.length === 0) return false;

      const latestDueSub = latestDueSubs[0];

      if (olderSubs.length > 0) {
        const olderKeys = olderSubs.map(s => getSubKey(s));
        const shouldRecalculate = shouldRecalculateAfterSkip(
          olderSubs,
          elapsedSeconds,
          currentHalf,
          halfDurationSeconds
        );

        setAutoSubPlan(prev => {
          const markedPlan = markSubsExecuted(prev, olderKeys, true);
          const executedSubs = markedPlan.filter(s => s.executed);
          const existingUnexecuted = markedPlan.filter(s => !s.executed);
          const recalculated = shouldRecalculate
            ? safeRecalculate(
                playersRef.current,
                halfDurationSeconds,
                elapsedSeconds,
                currentHalf,
                olderSubs[olderSubs.length - 1],
                existingUnexecuted
              )
            : existingUnexecuted;

          return validateAndFixRemainingPlan([...executedSubs, ...recalculated], playersRef.current);
        });

        toast({
          title: `${olderSubs.length} missed sub${olderSubs.length > 1 ? "s" : ""} skipped`,
          description: shouldRecalculate
            ? "Plan recalculated for remaining time"
            : "Remaining substitutions preserved",
        });
      }

      const dueSubs = latestDueSubs.filter(sub => !lockedPlayerIds.has(sub.playerOut.id));
      if (dueSubs.length === 0) {
        if (olderSubs.length > 0 && pendingAutoSub) {
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(false);
          setSubDuePlayerIds(new Set());
          if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
        }
        return olderSubs.length > 0;
      }

      if (
        pendingAutoSub &&
        pendingAutoSub.half === latestDueSub.half &&
        pendingAutoSub.time === latestDueSub.time
      ) {
        return olderSubs.length > 0;
      }

      if (pendingAutoSub) {
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        setSubDuePlayerIds(new Set());
        if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      }

      const [primarySub, ...additionalSubs] = dueSubs;

      const playerOutName = primarySub.playerOut.name || `#${primarySub.playerOut.number}`;
      const playerInName = primarySub.playerIn.name || `#${primarySub.playerIn.number}`;
      const notificationBody =
        dueSubs.length > 1
          ? `Time for ${dueSubs.length} substitutions`
          : `Time to sub: ${playerOutName} ➜ ${playerInName}`;
      playSubAlertBeep(notificationBody);

      const dueIds = new Set<string>();
      dueSubs.forEach(s => {
        dueIds.add(s.playerOut.id);
        dueIds.add(s.playerIn.id);
      });
      setSubDuePlayerIds(dueIds);
      if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      subDueTimerRef.current = setTimeout(() => setSubDuePlayerIds(new Set()), 30000);

      setPendingAutoSub(primarySub);
      setPendingBatchSubs(additionalSubs);
      setSubConfirmDialogOpen(true);

      // Poke the server so push fan-out to other staff (assistant coaches,
      // subs manager) happens immediately, before the open pitch board has
      // a chance to mark the sub executed and hide it from the cron.
      const dedupeKey = `${primarySub.half}-${primarySub.time}-${primarySub.playerOut.id}`;
      void triggerPitchCheck("pitch-board-pending-sub", dedupeKey);
      return true;
    },
    [autoSubActive, autoSubPlan, autoSubPaused, pendingAutoSub, lockedPlayerIds, toast, gameTimerRef, playersRef, safeRecalculate]
  );

  // ── Next-sub countdown updater ──────────────────────────

  const updateNextSubInfo = useCallback(
    (elapsedSeconds: number, currentHalf: 1 | 2) => {
      const isFinished = gameTimerRef.current?.isGameFinished();
      if (autoSubActive && autoSubPlan.length > 0 && !autoSubPaused && !isFinished) {
        const remainingSubs = autoSubPlan.filter(s => !s.executed);
        const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 10;
        const halfDurationSeconds = minsPerHalf * 60;
        const nextSub = findRelevantNextSub(remainingSubs, currentHalf, elapsedSeconds, halfDurationSeconds);
        if (nextSub) {
          const secsUntil =
            nextSub.half === currentHalf
              ? Math.max(0, nextSub.time - elapsedSeconds)
              : nextSub.time +
                (nextSub.half - currentHalf) * (gameTimerRef.current?.getMinutesPerHalf() || 10) * 60 -
                elapsedSeconds;
          const mins = Math.floor(secsUntil / 60);
          const secs = Math.floor(secsUntil % 60);
          setNextSubInfo({
            playerInId: nextSub.playerIn.id,
            playerOutId: nextSub.playerOut.id,
            countdown: `${mins}:${secs.toString().padStart(2, "0")}`,
          });
        } else {
          setNextSubInfo(null);
        }
      } else {
        if (isFinished) {
          setNextSubInfo(null);
          setSubDuePlayerIds(new Set());
          if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
          if (subConfirmDialogOpen) {
            setSubConfirmDialogOpen(false);
            setPendingAutoSub(null);
            setPendingBatchSubs([]);
          }
        }
        setNextSubInfo(prev => (prev ? null : prev));
      }
    },
    [autoSubActive, autoSubPlan, autoSubPaused, subConfirmDialogOpen, gameTimerRef]
  );

  // ── Half-change handler ─────────────────────────────────

  const checkHalftimeSubs = useCallback(
    (newHalf: 1 | 2) => {
      if (newHalf !== 2) return false;

      const staleFirstHalfSubs = autoSubPlan.filter(sub => !sub.executed && sub.half === 1);
      const halftimeSubs = autoSubPlan.filter(sub => !sub.executed && sub.half === 2 && sub.time === 0);

      if (staleFirstHalfSubs.length > 0) {
        const staleKeys = staleFirstHalfSubs.map(getSubKey);
        setAutoSubPlan(prev => markSubsExecuted(prev, staleKeys, true));
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        setSubDuePlayerIds(new Set());
        if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      }

      if (halftimeSubs.length === 0) {
        // No halftime subs — still show a halftime notification popup
        setTimeout(() => {
          playSubAlertBeep("Half time!");
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return true;
      }

      setTimeout(() => {
        const [primarySub, ...additionalSubs] = halftimeSubs;
        const notificationBody =
          halftimeSubs.length > 1
            ? `Halftime: ${halftimeSubs.length} substitutions`
            : `Halftime sub: ${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} ➜ ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`}`;
        playSubAlertBeep(notificationBody);
        setPendingAutoSub(primarySub);
        setPendingBatchSubs(additionalSubs);
        setSubConfirmDialogOpen(true);
      }, 500);

      return true;
    },
    [autoSubActive, autoSubPlan]
  );

  return {
    // State
    autoSubPlan,
    setAutoSubPlan,
    autoSubActive,
    setAutoSubActive,
    autoSubPaused,
    setAutoSubPaused,
    lockedPlayerIds,
    pendingAutoSub,
    setPendingAutoSub,
    pendingBatchSubs,
    setPendingBatchSubs,
    subConfirmDialogOpen,
    setSubConfirmDialogOpen,
    subDuePlayerIds,
    setSubDuePlayerIds,
    nextSubInfo,
    subDueTimerRef,

    // Plan lifecycle
    handleStartAutoSubPlan,
    handleCancelAutoSubPlan,
    handleTogglePauseAutoSub,
    handleToggleLockPlayer,
    handleSkipNextSub,
    handleExecuteNow,
    handleRegeneratePlan,
    regeneratePlanRef,

    // Confirm / skip
    handleConfirmAutoSub,
    handleSkipAutoSub,

    // Timer-driven helpers
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,

    // Internal refs (exposed for edge cases)
    skipCooldownRef,
    planActivationTimeRef,
  };
}
