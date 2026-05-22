import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Player } from "../types";
import type { SubstitutionEvent } from "../types";
import type { GameTimerRef } from "../GameTimer";
import {
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan,
} from "../pitchStateUtils";

interface UsePitchBoardPlanRepairArgs {
  players: Player[];
  playersOnPitch: Player[];
  playersRef: MutableRefObject<Player[]>;
  autoSubActive: boolean;
  autoSubPlan: SubstitutionEvent[];
  setAutoSubPlan: Dispatch<SetStateAction<SubstitutionEvent[]>>;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  handleCancelAutoSubPlan: () => void;
  gameTimerRef: MutableRefObject<GameTimerRef | null>;
  teamSize: string;
  rotateGkAtHalftime: boolean;
  toast: (opts: { title: string; description?: string }) => void;
}

/**
 * Centralises auto-sub plan repair concerns:
 *  - Re-validate/repair the remaining plan when on-pitch composition changes.
 *  - Cancel the plan if it references a removed player.
 *  - Provide `recalcPlanForInjury` used by injury handlers.
 */
export function usePitchBoardPlanRepair({
  players,
  playersOnPitch,
  playersRef,
  autoSubActive,
  autoSubPlan,
  setAutoSubPlan,
  regeneratePlanRef,
  handleCancelAutoSubPlan,
  gameTimerRef,
  teamSize,
  rotateGkAtHalftime,
  toast,
}: UsePitchBoardPlanRepairArgs) {
  // ── Auto-regenerate / repair when the on-pitch composition changes ──
  const onPitchSignatureRef = useRef<string>("");
  const lastRegenAtRef = useRef<number>(0);
  useEffect(() => {
    if (!autoSubActive) return;
    if (autoSubPlan.length === 0) return;
    const sig = playersOnPitch.map(p => p.id).sort().join("|");
    const prev = onPitchSignatureRef.current;
    if (!prev) {
      onPitchSignatureRef.current = sig;
      return;
    }
    if (prev === sig) return;
    onPitchSignatureRef.current = sig;

    const now = Date.now();
    if (now - lastRegenAtRef.current < 250) return;
    lastRegenAtRef.current = now;

    const t = setTimeout(() => {
      const currentPlayers = playersRef.current;
      const remaining = autoSubPlan.filter(s => !s.executed);
      if (remaining.length === 0) return;

      const benchIds = new Set(currentPlayers.filter(p => p.position === null).map(p => p.id));
      const pitchIds = new Set(currentPlayers.filter(p => p.position !== null).map(p => p.id));
      const matchedKeys = new Set<string>();
      const claimedPairs = new Set<string>();
      const remainingSorted = [...remaining].sort((a, b) => {
        const at = a.half === 1 ? a.time : 100000 + a.time;
        const bt = b.half === 1 ? b.time : 100000 + b.time;
        return at - bt;
      });
      remainingSorted.forEach(s => {
        const pairKey = `${s.playerOut.id}->${s.playerIn.id}`;
        if (claimedPairs.has(pairKey)) return;
        if (benchIds.has(s.playerOut.id) && pitchIds.has(s.playerIn.id)) {
          matchedKeys.add(`${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`);
          claimedPairs.add(pairKey);
        }
      });

      const repaired = validateAndFixRemainingPlan(
        autoSubPlan.map(s => {
          const k = `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`;
          return matchedKeys.has(k) ? { ...s, executed: true } : s;
        }),
        currentPlayers
      );

      const remainingAfterRepair = repaired.filter(s => !s.executed);
      const benchAvailable = currentPlayers.filter(p => p.position === null && !p.isInjured);

      if (remainingAfterRepair.length === 0 && benchAvailable.length > 0) {
        regeneratePlanRef.current?.();
        return;
      }

      setAutoSubPlan(repaired);
    }, 50);
    return () => clearTimeout(t);
  }, [playersOnPitch, autoSubActive, autoSubPlan, regeneratePlanRef, playersRef, setAutoSubPlan]);

  // ── Cancel auto-subs if the plan references a player who no longer exists ──
  useEffect(() => {
    if (!autoSubActive || autoSubPlan.length === 0) return;
    const playerIds = new Set(players.map(p => p.id));
    const remaining = autoSubPlan.filter(s => !s.executed);
    const orphaned = remaining.some(
      s => !playerIds.has(s.playerIn.id) || !playerIds.has(s.playerOut.id)
    );
    if (orphaned) {
      handleCancelAutoSubPlan();
      toast({
        title: "Auto-subs cancelled",
        description: "A player in the plan was removed",
      });
    }
  }, [players, autoSubActive, autoSubPlan, handleCancelAutoSubPlan, toast]);

  /**
   * Recalculate the remaining plan when a player becomes injured (either via
   * the bench injury toggle or an on-pitch injury sub). Returns the new plan
   * to be committed via `setAutoSubPlan` plus a flag indicating whether the
   * caller should surface the "Sub plan updated" toast.
   */
  const recalcPlanForInjury = useCallback(
    (updatedPlayers: Player[], injuredId: string, replacementId?: string) => {
      if (!autoSubPlan.some(s => !s.executed)) return null;

      const minutesPerHalfSecs = (gameTimerRef.current?.getMinutesPerHalf() || 10) * 60;
      const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
      const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;

      const executedSubs = autoSubPlan.filter(s => s.executed);
      const remainingSubs = autoSubPlan.filter(s => !s.executed);
      const anchor =
        remainingSubs.find(
          sub =>
            sub.playerIn.id === injuredId ||
            sub.playerOut.id === injuredId ||
            (replacementId &&
              (sub.playerIn.id === replacementId || sub.playerOut.id === replacementId))
        ) || remainingSubs[0];

      const recalculated = recalculateRemainingPlan(
        updatedPlayers,
        parseInt(teamSize),
        minutesPerHalfSecs,
        currentElapsed,
        currentHalf,
        anchor,
        rotateGkAtHalftime
      );

      let finalPlan: SubstitutionEvent[];
      if (recalculated.length > 0 || remainingSubs.length === 0) {
        finalPlan = [...executedSubs, ...recalculated];
      } else {
        const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
        if (benchPlayers.length > 0) {
          console.warn("[PitchBoard] Injury recalculation returned empty — preserving existing plan");
          finalPlan = [
            ...executedSubs,
            ...remainingSubs.filter(
              s => s.playerIn.id !== injuredId && s.playerOut.id !== injuredId
            ),
          ];
        } else {
          finalPlan = [...executedSubs, ...recalculated];
        }
      }
      setAutoSubPlan(finalPlan);
      toast({
        title: "Sub plan updated",
        description: "Auto-substitution plan recalculated due to injury",
      });
      return finalPlan;
    },
    [autoSubPlan, gameTimerRef, teamSize, rotateGkAtHalftime, setAutoSubPlan, toast]
  );

  return { recalcPlanForInjury };
}
