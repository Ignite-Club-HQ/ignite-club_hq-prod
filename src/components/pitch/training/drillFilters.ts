import type { DrillSummary } from "./drillStorage";

/**
 * Canonical age-group choices shown in the drill library filter. Covers the
 * common youth bands (U6 → U14) plus a "Senior / 15+" bucket. "All" disables
 * the filter; "All ages" drills always pass through.
 */
export const AGE_GROUP_FILTER_OPTIONS = [
  "All",
  "U6",
  "U7",
  "U8",
  "U9",
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "Senior (15+)",
] as const;

export type AgeGroupFilter = (typeof AGE_GROUP_FILTER_OPTIONS)[number];

/**
 * Player-count buckets reflect the number of players ACTIVE in the activity at
 * one time (not players sitting on the sideline waiting for a turn). Drills
 * record this in `players_required`.
 */
export const PLAYER_COUNT_FILTER_OPTIONS = [
  { value: "all", label: "Any number", min: 0, max: Infinity },
  { value: "1-3", label: "1–3 active", min: 1, max: 3 },
  { value: "4-6", label: "4–6 active", min: 4, max: 6 },
  { value: "7-10", label: "7–10 active", min: 7, max: 10 },
  { value: "11+", label: "11+ active", min: 11, max: Infinity },
] as const;

export type PlayerCountFilterValue = (typeof PLAYER_COUNT_FILTER_OPTIONS)[number]["value"];

/**
 * Convert a UI age-filter selection to a numeric U-band, where Senior maps to
 * 99 (matches anything U15+ / no upper bound). Returns null for "All".
 */
function selectedToBand(selection: AgeGroupFilter): number | null {
  if (selection === "All") return null;
  if (selection === "Senior (15+)") return 99;
  const m = /^U(\d+)$/.exec(selection);
  return m ? Number(m[1]) : null;
}

/**
 * Parse a drill's stored age_group string ("U6", "U10-U14", "U9+", "All ages",
 * "U7-U10", etc.) into a min/max numeric band. Returns null when unparseable —
 * those drills are then excluded from a specific-age search but always shown
 * when the filter is "All".
 */
function parseDrillAgeBand(raw?: string): { min: number; max: number } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "all ages" || s === "all") return { min: 0, max: 99 };

  // "U10-U14"
  const range = /^u(\d+)\s*-\s*u(\d+)$/.exec(s);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };

  // "U9+"
  const open = /^u(\d+)\+$/.exec(s);
  if (open) return { min: Number(open[1]), max: 99 };

  // "U10"
  const exact = /^u(\d+)$/.exec(s);
  if (exact) return { min: Number(exact[1]), max: Number(exact[1]) };

  return null;
}

/**
 * Apply age-group + player-count filters in memory. Cheap (~O(n)) and runs
 * after the existing search filter so the UI stays responsive.
 */
export function applyDrillFilters(
  drills: DrillSummary[],
  ageFilter: AgeGroupFilter,
  playerFilter: PlayerCountFilterValue,
): DrillSummary[] {
  const targetBand = selectedToBand(ageFilter);
  const playerOption = PLAYER_COUNT_FILTER_OPTIONS.find((o) => o.value === playerFilter);
  const playerMin = playerOption?.min ?? 0;
  const playerMax = playerOption?.max ?? Infinity;

  return drills.filter((d) => {
    if (targetBand !== null) {
      const drillBand = parseDrillAgeBand(d.ageGroup);
      // If we can't parse the drill's band, exclude from a specific-age query
      // (otherwise the filter would be meaningless).
      if (!drillBand) return false;
      if (targetBand < drillBand.min || targetBand > drillBand.max) return false;
    }

    if (playerFilter !== "all") {
      const n = d.playersRequired;
      // Drills missing a player count don't match a specific-count filter.
      if (typeof n !== "number") return false;
      if (n < playerMin || n > playerMax) return false;
    }

    return true;
  });
}
