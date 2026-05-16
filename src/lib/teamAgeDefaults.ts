/**
 * Age-based defaults derived from a team's name.
 *
 * Used as a fallback when a team has no persisted `team_subscriptions` row,
 * so junior teams don't open the pitch board with the legacy 10-minute halves.
 *
 * Rules (per product):
 *   U6  – U11  → 20 minute halves
 *   U12, U13, U15 → 25 minute halves
 *   anything else → 25 minute halves (sensible adult/competition default)
 */

/** Extract the first "U<number>" age band from a team name (case-insensitive). */
export function parseTeamAgeYears(teamName: string | null | undefined): number | null {
  if (!teamName) return null;
  const m = teamName.match(/\bU\s*-?\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Default minutes-per-half for a team based on its name.
 * Returns the configured fallback (default 20) when no age band can be parsed.
 */
export function defaultMinutesPerHalfForTeamName(
  teamName: string | null | undefined,
  fallback: number = 20
): number {
  const age = parseTeamAgeYears(teamName);
  if (age === null) return fallback;
  if (age <= 11) return 20;
  // U12, U13, U14, U15+ → 25
  return 25;
}
