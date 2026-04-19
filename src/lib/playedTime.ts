/**
 * Shared formatting helper for player time-on-court.
 *
 * IMPORTANT: throughout the basketball + netball + soccer boards the field
 * historically called `minutesPlayed` actually stores **seconds** (incremented
 * by `safeDelta` each tick). Renaming the field across 26 files is a big
 * refactor; instead we centralise the seconds → display conversion here so
 * UI never accidentally treats the raw number as minutes.
 */

/** Returns "12m 34s" (or "0m 04s" for short games). */
export function formatPlayedTime(seconds: number | undefined | null): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

/** Returns just the integer minutes (rounded down). */
export function toMinutes(seconds: number | undefined | null): number {
  return Math.floor(Math.max(0, seconds ?? 0) / 60);
}

/** Compact "12m" for badges where space is tight. */
export function formatPlayedTimeCompact(seconds: number | undefined | null): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}
