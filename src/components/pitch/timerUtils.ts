/**
 * Centralized timer projection utilities.
 * Single source of truth for extrapolating elapsed game seconds from a TimerState.
 * Replaces ~12 duplicated inline blocks across the pitch module.
 */
import { TimerState } from "./types";

/** Maximum seconds to extrapolate forward from the last persisted timestamp.
 *  Prevents overshoot when the app backgrounds (JS timers freeze but Date.now() keeps ticking). */
export const MAX_EXTRAPOLATION_SECS = 30;

/**
 * Calculate how many seconds have actually passed since the timer was last persisted,
 * capped to MAX_EXTRAPOLATION_SECS.
 */
export const getSecondsSinceUpdate = (
  lastUpdateTime: number | undefined | null,
  now: number = Date.now()
): number => {
  if (!lastUpdateTime) return 0;
  return Math.min(
    Math.max(0, Math.floor((now - lastUpdateTime) / 1000)),
    MAX_EXTRAPOLATION_SECS
  );
};

/**
 * Like getSecondsSinceUpdate but WITHOUT the 30s cap.
 * Used when the app resumes from background to reconcile the full elapsed time.
 * Capped only by halfDuration to prevent overshoot.
 */
export const getSecondsSinceUpdateUncapped = (
  lastUpdateTime: number | undefined | null,
  now: number = Date.now()
): number => {
  if (!lastUpdateTime) return 0;
  return Math.max(0, Math.floor((now - lastUpdateTime) / 1000));
};

/**
 * Get the current projected elapsed seconds for the active half.
 * This is the ONE function all code should call instead of inline extrapolation.
 *
 * @param timerState - The persisted timer state (or null)
 * @param now - Optional timestamp override (for testing / consistent reads)
 * @returns Elapsed seconds clamped to [0, halfDuration]
 */
export const getCurrentGameSeconds = (
  timerState: TimerState | null | undefined,
  now: number = Date.now()
): number => {
  if (!timerState) return 0;

  const halfDuration = timerState.minutesPerHalf * 60;
  const base = timerState.elapsedSeconds || 0;

  if (!timerState.isRunning) {
    return Math.min(base, halfDuration);
  }

  const extrapolated = base + getSecondsSinceUpdate(timerState.lastUpdateTime, now);
  return Math.min(extrapolated, halfDuration);
};
