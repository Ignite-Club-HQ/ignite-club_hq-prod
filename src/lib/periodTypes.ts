/**
 * Period type helpers — shared between basketball + netball boards.
 * "Quarters" = 4 periods (default for both sports).
 * "Halves" = 2 periods (junior leagues, half-court formats).
 *
 * The underlying timer state still tracks `currentQuarter` 1..4 for
 * compatibility, but in halves mode we map Q1↔H1, Q3↔H2, and skip
 * Q2 / Q4 entirely.
 */
import type { PeriodType } from "@/components/basketball/types";

export const periodCount = (pt: PeriodType | undefined): number =>
  pt === "halves" ? 2 : 4;

/** "Q" or "H" — used as the prefix in timer chips and lineup tabs. */
export const periodPrefix = (pt: PeriodType | undefined): "Q" | "H" =>
  pt === "halves" ? "H" : "Q";

/**
 * Display label for the current period given the underlying quarter slot
 * (1..4) and the period type.
 *  - quarters: "Q1", "Q2", "Q3", "Q4"
 *  - halves:   "H1", "H1", "H2", "H2"  (so a runaway timer never shows "Q3" in halves mode)
 */
export const periodLabel = (
  quarter: 1 | 2 | 3 | 4,
  pt: PeriodType | undefined
): string => {
  if (pt === "halves") return `H${quarter <= 2 ? 1 : 2}`;
  return `Q${quarter}`;
};

/** All period slots (1..4) that are user-facing for the given period type. */
export const visiblePeriods = (pt: PeriodType | undefined): (1 | 2 | 3 | 4)[] =>
  pt === "halves" ? [1, 3] : [1, 2, 3, 4];
