import { PitchPosition } from "./PositionBadge";
import { TeamSize } from "./types";

export type TacticalMode = "neutral" | "attack" | "defend";

/**
 * Calculates visual position offsets for a player based on the current tactical mode.
 * Returns adjusted { x, y } percentages — no mutation, pure function.
 */
export const applyTacticalOffset = (
  baseX: number,
  baseY: number,
  pitchPosition: PitchPosition | undefined,
  mode: TacticalMode,
  teamSize: TeamSize,
): { x: number; y: number } => {
  if (mode === "neutral" || !pitchPosition) {
    return { x: baseX, y: baseY };
  }

  let dx = 0;
  let dy = 0;

  // Determine if this is a junior/small-sided game (safer caps)
  const isSmallSided = parseInt(teamSize) <= 7;
  const safeMinY = isSmallSided ? 12 : 8; // Don't push too close to edges
  const safeMaxY = isSmallSided ? 92 : 94;

  if (mode === "attack") {
    switch (pitchPosition) {
      case "GK":
        dy = -2; // GK steps up slightly
        break;
      case "DEF":
        dy = -4; // Back line steps up
        break;
      case "MID":
        dy = -5; // Midfield pushes higher
        // Wide mids spread slightly
        if (baseX < 40) dx = -2;
        else if (baseX > 60) dx = 2;
        break;
      case "FWD":
        dy = -4; // Forwards push higher
        // Wide forwards spread
        if (baseX < 40) dx = -3;
        else if (baseX > 60) dx = 3;
        break;
    }
  } else if (mode === "defend") {
    switch (pitchPosition) {
      case "GK":
        dy = 1; // GK stays deep
        break;
      case "DEF":
        dy = 4; // Deeper defensive line
        // Wide defenders tuck in
        if (baseX < 35) dx = 3;
        else if (baseX > 65) dx = -3;
        break;
      case "MID":
        dy = 3; // Mid drops slightly
        // Wide mids tuck in
        if (baseX < 35) dx = 2;
        else if (baseX > 65) dx = -2;
        break;
      case "FWD":
        dy = 2; // Forwards drop slightly
        break;
    }
  }

  // Clamp to safe bounds
  const newY = Math.max(safeMinY, Math.min(safeMaxY, baseY + dy));
  const newX = Math.max(3, Math.min(97, baseX + dx));

  return { x: newX, y: newY };
};

/** Toast messages for mode changes */
export const TACTICAL_MODE_MESSAGES: Record<TacticalMode, string> = {
  attack: "Attack mode enabled",
  defend: "Defensive shape enabled",
  neutral: "Balanced shape restored",
};

/** Labels for the timer subtitle */
export const TACTICAL_MODE_LABELS: Record<TacticalMode, string> = {
  attack: "Attack",
  defend: "Defend",
  neutral: "Neutral",
};
