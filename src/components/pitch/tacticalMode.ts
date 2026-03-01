import { PitchPosition } from "./PositionBadge";
import { TeamSize, Player } from "./types";

export type TacticalMode = "neutral" | "attack" | "defend";

interface TacticalPosition {
  x: number;
  y: number;
  isAnchor?: boolean; // Defend mode: this mid is the anchor
}

/**
 * Batch-calculate tactical positions for ALL on-pitch players.
 * This allows context-aware decisions like "only one mid pushes higher" 
 * and "pick one central mid as anchor".
 */
export const computeTacticalPositions = (
  players: Player[],
  mode: TacticalMode,
  teamSize: TeamSize,
): Map<string, TacticalPosition> => {
  const result = new Map<string, TacticalPosition>();
  const onPitch = players.filter(p => p.position !== null);

  if (mode === "neutral") {
    for (const p of onPitch) {
      result.set(p.id, { x: p.position!.x, y: p.position!.y });
    }
    return result;
  }

  const isSmallSided = parseInt(teamSize) <= 7;
  const safeMinY = isSmallSided ? 14 : 10;
  const safeMaxY = isSmallSided ? 92 : 94;

  // Classify players by position
  const midfielders = onPitch.filter(p => p.currentPitchPosition === "MID");
  const isWide = (x: number) => x < 40 || x > 60;
  const isLeft = (x: number) => x < 50;

  // For ATTACK: pick one most-central midfielder to push higher
  let attackPushMidId: string | null = null;
  if (mode === "attack" && midfielders.length > 0) {
    // Pick the midfielder closest to center-x
    const sorted = [...midfielders].sort((a, b) => 
      Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
    );
    attackPushMidId = sorted[0].id;
  }

  // For DEFEND: pick one central midfielder as anchor
  let anchorMidId: string | null = null;
  if (mode === "defend" && midfielders.length > 0) {
    const centralMids = midfielders.filter(m => !isWide(m.position!.x));
    const sorted = (centralMids.length > 0 ? centralMids : midfielders).sort((a, b) =>
      Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
    );
    anchorMidId = sorted[0].id;
  }

  for (const p of onPitch) {
    const bx = p.position!.x;
    const by = p.position!.y;
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
          // Wide defenders push out slightly
          if (isWide(bx)) dx = isLeft(bx) ? -2 : 2;
          break;
        case "MID":
          if (p.id === attackPushMidId) {
            // This one central mid pushes significantly higher
            dy = isSmallSided ? -6 : -8;
          } else {
            dy = -3;
          }
          // Wide mids spread wider
          if (isWide(bx)) dx = isLeft(bx) ? -4 : 4;
          break;
        case "FWD":
          dy = isSmallSided ? -3 : -5;
          // Wide forwards spread
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
          // Wide defenders tuck in
          if (isWide(bx)) dx = isLeft(bx) ? 4 : -4;
          break;
        case "MID":
          if (p.id === anchorMidId) {
            // Anchor drops deeper and stays central
            dy = isSmallSided ? 5 : 7;
            // Pull toward center
            if (bx < 45) dx = 3;
            else if (bx > 55) dx = -3;
            isAnchor = true;
          } else {
            dy = 3;
            // Wide mids tuck in
            if (isWide(bx)) dx = isLeft(bx) ? 3 : -3;
          }
          break;
        case "FWD":
          dy = 2;
          // Forwards tuck in slightly
          if (isWide(bx)) dx = isLeft(bx) ? 2 : -2;
          break;
      }
    }

    const newX = Math.max(4, Math.min(96, bx + dx));
    const newY = Math.max(safeMinY, Math.min(safeMaxY, by + dy));
    result.set(p.id, { x: newX, y: newY, isAnchor });
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
