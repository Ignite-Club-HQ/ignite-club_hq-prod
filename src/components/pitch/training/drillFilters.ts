import type { DrillSummary } from "./drillStorage";

export type AgeGroupFilter =
  | "all"
  | "U6"
  | "U8"
  | "U10"
  | "U12"
  | "U14"
  | "U16"
  | "U18"
  | "Senior";

export type PlayerCountFilterValue = "all" | "1-3" | "4-6" | "7-10" | "11+";

export const AGE_GROUP_OPTIONS: { value: AgeGroupFilter; label: string }[] = [
  { value: "all", label: "All ages" },
  { value: "U6", label: "U6" },
  { value: "U8", label: "U8" },
  { value: "U10", label: "U10" },
  { value: "U12", label: "U12" },
  { value: "U14", label: "U14" },
  { value: "U16", label: "U16" },
  { value: "U18", label: "U18" },
  { value: "Senior", label: "Senior" },
];

export const PLAYER_COUNT_OPTIONS: { value: PlayerCountFilterValue; label: string }[] = [
  { value: "all", label: "Any number" },
  { value: "1-3", label: "1–3 active" },
  { value: "4-6", label: "4–6 active" },
  { value: "7-10", label: "7–10 active" },
  { value: "11+", label: "11+ active" },
];

const AGE_RANK: Record<Exclude<AgeGroupFilter, "all">, number> = {
  U6: 6,
  U8: 8,
  U10: 10,
  U12: 12,
  U14: 14,
  U16: 16,
  U18: 18,
  Senior: 99,
};

interface AgeBand {
  min: number;
  max: number;
}

/**
 * Parses a free-form drill age group string like "U10", "U10-U14", "U9+",
 * "All ages", or "Senior" into a numeric band. Returns null when the string
 * cannot be interpreted (e.g. empty / unrecognised), which means the drill
 * should not be filtered out by age.
 */
export function parseDrillAgeBand(raw: string | null | undefined): AgeBand | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("all")) return { min: 0, max: 99 };
  if (s.includes("senior") || s.includes("adult")) return { min: 18, max: 99 };

  // Range like "U10-U14" or "U10 to U14"
  const range = s.match(/u\s*(\d{1,2})\s*[-–to]+\s*u?\s*(\d{1,2})/);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  // Open-ended like "U9+"
  const plus = s.match(/u\s*(\d{1,2})\s*\+/);
  if (plus) {
    const n = parseInt(plus[1], 10);
    return { min: n, max: 99 };
  }

  // Single age like "U10"
  const single = s.match(/u\s*(\d{1,2})/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { min: n, max: n };
  }

  return null;
}

function playerBucket(filter: PlayerCountFilterValue): { min: number; max: number } | null {
  switch (filter) {
    case "1-3":
      return { min: 1, max: 3 };
    case "4-6":
      return { min: 4, max: 6 };
    case "7-10":
      return { min: 7, max: 10 };
    case "11+":
      return { min: 11, max: Number.POSITIVE_INFINITY };
    default:
      return null;
  }
}

export function applyDrillFilters(
  drills: DrillSummary[] | undefined | null,
  ageFilter: AgeGroupFilter,
  playerFilter: PlayerCountFilterValue,
): DrillSummary[] {
  if (!drills) return [];
  const targetAge = ageFilter === "all" ? null : AGE_RANK[ageFilter];
  const playerRange = playerBucket(playerFilter);

  return drills.filter((d) => {
    if (targetAge !== null) {
      const band = parseDrillAgeBand(d.ageGroup);
      // If the drill has no parseable age info, hide it when a specific age
      // filter is active so the result set is meaningful.
      if (!band) return false;
      if (targetAge < band.min || targetAge > band.max) return false;
    }
    if (playerRange) {
      const n = d.playersRequired;
      if (typeof n !== "number") return false;
      if (n < playerRange.min || n > playerRange.max) return false;
    }
    return true;
  });
}
