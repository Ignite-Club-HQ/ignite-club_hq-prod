import { PitchPosition } from "./PositionBadge";
import { TeamSize, Player, FORMATIONS } from "./types";

/**
 * Recommended formation indices per team size for each tactical mode.
 * Maps to the FORMATIONS array index. Neutral = no recommendation (keep current).
 * Based on: attack = more forwards, defend = more defenders.
 */
export const RECOMMENDED_FORMATIONS: Record<TeamSize, { attack: number; defend: number }> = {
  "3":  { attack: 2, defend: 1 },   // Attack: 1-2 (2 fwd), Defend: 2-1 (2 def)
  "4":  { attack: 2, defend: 1 },   // Attack: 1-1-2, Defend: 2-1-1
  "5":  { attack: 1, defend: 3 },   // Attack: 2-1-2, Defend: 2-2-1
  "6":  { attack: 2, defend: 0 },   // Attack: 2-1-2, Defend: 2-2-1
  "7":  { attack: 2, defend: 1 },   // Attack: 2-2-2, Defend: 3-2-1
  "8":  { attack: 1, defend: 2 },   // Attack: 2-3-2, Defend: 3-2-2
  "9":  { attack: 1, defend: 0 },   // Attack: 3-2-3, Defend: 3-3-2
  "10": { attack: 2, defend: 1 },   // Attack: 3-3-3, Defend: 4-3-2
  "11": { attack: 1, defend: 2 },   // Attack: 4-3-3, Defend: 3-5-2
};

export type TacticalMode = "neutral" | "attack" | "defend";

interface TacticalOffset {
  dx: number; // percentage-point shift in X
  dy: number; // percentage-point shift in Y
  isAnchor?: boolean;
}

/**
 * Batch-calculate tactical OFFSETS (not absolute positions) for all on-pitch players.
 * Returns a Map of playerId → { dx, dy } pixel-percentage offsets to apply via CSS translate.
 * The stored player.position is never modified — offsets are purely visual.
 */
export const computeTacticalOffsets = (
  players: Player[],
  mode: TacticalMode,
  teamSize: TeamSize,
): Map<string, TacticalOffset> => {
  const result = new Map<string, TacticalOffset>();
  const onPitch = players.filter(p => p.position !== null);

  if (mode === "neutral") {
    return result; // empty map = no offsets
  }

  const isSmallSided = parseInt(teamSize) <= 7;
  const isWide = (x: number) => x < 40 || x > 60;
  const isLeft = (x: number) => x < 50;

  // Keep tactical shifts line-based so formation structure stays visually aligned

  for (const p of onPitch) {
    const bx = p.position!.x;
    const pos = p.currentPitchPosition;
    let dx = 0;
    let dy = 0;
    let isAnchor = false;

    if (mode === "attack") {
      switch (pos) {
        case "GK":
          dy = -2;
          break;
        case "DEF":
          dy = isSmallSided ? -3 : -5;
          if (isWide(bx)) dx = isLeft(bx) ? -2 : 2;
          break;
        case "MID":
          dy = isSmallSided ? -3 : -4;
          if (isWide(bx)) dx = isLeft(bx) ? -3 : 3;
          break;
        case "FWD":
          dy = isSmallSided ? -3 : -5;
          if (isWide(bx)) dx = isLeft(bx) ? -4 : 4;
          break;
      }
    } else if (mode === "defend") {
      switch (pos) {
        case "GK":
          dy = 2;
          break;
        case "DEF":
          dy = isSmallSided ? 3 : 5;
          if (isWide(bx)) dx = isLeft(bx) ? 4 : -4;
          break;
        case "MID":
          dy = isSmallSided ? 3 : 4;
          if (isWide(bx)) dx = isLeft(bx) ? 3 : -3;
          break;
        case "FWD":
          dy = 2;
          if (isWide(bx)) dx = isLeft(bx) ? 2 : -2;
          break;
      }
    }

    if (dx !== 0 || dy !== 0) {
      result.set(p.id, { dx, dy, isAnchor });
    }
  }

  return result;
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
