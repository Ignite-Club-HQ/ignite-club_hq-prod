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

  // Classify midfielders for special roles
  const midfielders = onPitch.filter(p => p.currentPitchPosition === "MID");

  // ATTACK: pick one most-central midfielder to push higher
  let attackPushMidId: string | null = null;
  if (mode === "attack" && midfielders.length > 0) {
    const sorted = [...midfielders].sort((a, b) =>
      Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
    );
    attackPushMidId = sorted[0].id;
  }

  // DEFEND: pick one central midfielder as anchor
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
    const pos = p.currentPitchPosition;
    let dx = 0;
    let dy = 0;
    let isAnchor = false;

    if (mode === "attack") {
      switch (pos) {
        case "GK":
          dy = -2; // sweeper-keeper: barely off line
          break;
        case "DEF":
          // Push up slightly to compress space; wide defenders spread
          dy = isSmallSided ? -3 : -4;
          if (isWide(bx)) dx = isLeft(bx) ? -2 : 2; // spread wide
          break;
        case "MID":
          // Midfield pushes noticeably higher (all mids keep same vertical line)
          dy = isSmallSided ? -5 : -7;
          if (p.id === attackPushMidId) {
            // Central playmaker only adjusts horizontally to stay aligned vertically
            if (isWide(bx)) dx = isLeft(bx) ? 2 : -2; // tuck central
          } else {
            // Wide mids spread out
            if (isWide(bx)) dx = isLeft(bx) ? -3 : 3;
          }
          break;
        case "FWD":
          // Forwards push highest, stretch the pitch
          dy = isSmallSided ? -6 : -8;
          if (isWide(bx)) dx = isLeft(bx) ? -3 : 3; // wide forwards spread
          break;
      }
    } else if (mode === "defend") {
      switch (pos) {
        case "GK":
          dy = 1; // stay deep
          break;
        case "DEF":
          // Defenders drop deep and tuck in to be compact
          dy = isSmallSided ? 4 : 6;
          if (isWide(bx)) dx = isLeft(bx) ? 2 : -2; // tuck narrow
          break;
        case "MID":
          // Midfield drops moderately to shield defence (all mids keep same vertical line)
          dy = isSmallSided ? 2 : 4;
          if (p.id === anchorMidId) {
            // Anchor only adjusts horizontally to stay central
            if (bx < 45) dx = 2;
            else if (bx > 55) dx = -2;
            isAnchor = true;
          } else {
            // Wide mids tuck in
            if (isWide(bx)) dx = isLeft(bx) ? 2 : -2;
          }
          break;
        case "FWD":
          // Forwards drop only a little — stay as outlet
          dy = isSmallSided ? 2 : 3;
          if (isWide(bx)) dx = isLeft(bx) ? 1 : -1; // slight tuck
          break;
      }
    }

    if (dx !== 0 || dy !== 0) {
      const baseY = p.position!.y;
      // Clamp so players never go above y=20% (under timer/score overlays) or below y=95%
      const finalY = baseY + dy;
      if (finalY < 20) dy = 20 - baseY;
      if (finalY > 84) dy = 84 - baseY;
      // Clamp horizontal to stay within pitch (2%-98%)
      const finalX = bx + dx;
      if (finalX < 2) dx = 2 - bx;
      if (finalX > 98) dx = 98 - bx;
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
