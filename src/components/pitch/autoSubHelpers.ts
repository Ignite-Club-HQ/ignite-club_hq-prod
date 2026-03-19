/**
 * Shared auto-sub helper utilities.
 * Centralizes duplicated logic from PitchBoard.tsx and GlobalSubMonitor.tsx
 * to prevent divergence bugs.
 */
import { Player, SubstitutionEvent } from "./types";

/**
 * Generate a unique, deterministic key for a substitution event.
 * Used for matching subs across confirm/skip/execute flows.
 */
export const getSubKey = (sub: SubstitutionEvent): string =>
  `${sub.half}-${sub.time}-${sub.playerOut.id}`;

/**
 * Find the next due or upcoming substitution from a plan.
 * Returns the chronologically next unexecuted sub relative to the current game time.
 */
export const findNextSub = (
  plan: SubstitutionEvent[],
  currentHalf: 1 | 2,
  currentElapsedSeconds: number
): SubstitutionEvent | undefined => {
  const remaining = plan.filter(s => !s.executed);
  return (
    remaining.find(s => s.half === currentHalf && s.time >= currentElapsedSeconds) ||
    remaining.find(s => s.half > currentHalf) ||
    remaining[0]
  );
};

/**
 * Find all subs in the same time window as the given sub (batch partners).
 */
export const findBatchSubs = (
  plan: SubstitutionEvent[],
  primarySub: SubstitutionEvent
): SubstitutionEvent[] => {
  return plan.filter(
    s => !s.executed && s.half === primarySub.half && s.time === primarySub.time && s !== primarySub
  );
};

/**
 * Execute a list of substitutions on a player array, returning the updated players.
 * Handles position swaps, bench-replacement fallbacks, and invalid-sub skipping.
 * Returns { updatedPlayers, executedSubKeys, successCount }.
 */
export const executeSubsOnPlayers = (
  allSubs: SubstitutionEvent[],
  currentPlayers: Player[]
): {
  updatedPlayers: Player[];
  executedSubKeys: string[];
  successCount: number;
} => {
  let updatedPlayers = [...currentPlayers];
  const executedSubKeys: string[] = [];
  let successCount = 0;

  for (const sub of allSubs) {
    const { playerOut, playerIn, positionSwap } = sub;

    const currentPlayerOut = updatedPlayers.find(p => p.id === playerOut.id);
    let currentPlayerIn = updatedPlayers.find(p => p.id === playerIn.id);
    let actualPlayerInId = playerIn.id;

    // Validate playerIn is on bench (position === null)
    if (!currentPlayerIn || currentPlayerIn.position !== null) {
      // Try bench replacement
      const benchReplacement = updatedPlayers.find(
        p =>
          p.position === null &&
          !p.isInjured &&
          p.id !== playerOut.id &&
          !(p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) &&
          !allSubs.some(s => s.playerIn.id === p.id && s !== sub)
      );

      if (benchReplacement) {
        currentPlayerIn = benchReplacement;
        actualPlayerInId = benchReplacement.id;
      } else {
        executedSubKeys.push(getSubKey(sub));
        continue;
      }
    }

    // Validate playerOut is on pitch
    if (!currentPlayerOut?.position) {
      executedSubKeys.push(getSubKey(sub));
      continue;
    }

    const pitchPosition = { ...currentPlayerOut.position };
    const pitchPositionType = currentPlayerOut.currentPitchPosition;

    // Apply position swap if using original playerIn
    if (positionSwap && actualPlayerInId === playerIn.id) {
      const swapPlayer = updatedPlayers.find(p => p.id === positionSwap.player.id);
      if (swapPlayer?.position) {
        const swapPosition = { ...swapPlayer.position };
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
          if (p.id === positionSwap.player.id) return { ...p, position: pitchPosition, currentPitchPosition: positionSwap.toPosition };
          if (p.id === actualPlayerInId) return { ...p, position: swapPosition, currentPitchPosition: positionSwap.fromPosition };
          return p;
        });
      } else {
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
          if (p.id === actualPlayerInId) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
          return p;
        });
      }
    } else {
      updatedPlayers = updatedPlayers.map(p => {
        if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
        if (p.id === actualPlayerInId) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        return p;
      });
    }

    executedSubKeys.push(getSubKey(sub));
    successCount++;
  }

  return { updatedPlayers, executedSubKeys, successCount };
};

/**
 * Mark subs as executed in a plan by their keys.
 */
export const markSubsExecuted = (
  plan: SubstitutionEvent[],
  subKeys: string[],
  skipped = false
): SubstitutionEvent[] => {
  const keySet = new Set(subKeys);
  return plan.map(sub =>
    keySet.has(getSubKey(sub))
      ? { ...sub, executed: true, ...(skipped ? { skipped: true } : {}) }
      : sub
  );
};

/**
 * Calculate delay in seconds between when a sub was scheduled and current game time.
 */
export const calculateSubDelay = (
  sub: SubstitutionEvent,
  currentElapsed: number,
  currentHalf: 1 | 2,
  halfDurationSeconds: number
): number => {
  const subTotalSeconds = sub.half === 1 ? sub.time : halfDurationSeconds + sub.time;
  const currentTotalSeconds = currentHalf === 1 ? currentElapsed : halfDurationSeconds + currentElapsed;
  return Math.max(0, currentTotalSeconds - subTotalSeconds);
};
