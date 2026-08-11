export const ADVANCED_OVERRIDE_DEFAULTS = {
  standardTargetIntervalSec: 7 * 60,
  standardIntervalFloorSec: 4 * 60,
  frequentIntervalFloorSec: 180,
  minShiftSeconds: 180,
  halftimeGuardSeconds: 180,
} as const;

export const ADVANCED_OVERRIDE_RANGES = {
  standardTargetIntervalSec: { min: 180, max: 900 },
  standardIntervalFloorSec: { min: 120, max: 600 },
  frequentIntervalFloorSec: { min: 60, max: 420 },
  minShiftSeconds: { min: 60, max: 360 },
  halftimeGuardSeconds: { min: 0, max: 420 },
} as const;

export interface PlannerAdvancedOverrides {
  standardIntervalFloorSec?: number;
  standardTargetIntervalSec?: number;
  frequentIntervalFloorSec?: number;
  minShiftSeconds?: number;
  halftimeGuardSeconds?: number;
  maxSpreadOverrideSec?: number;
  playerPriorityOrder?: string[];
}
