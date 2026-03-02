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
  const isWide = (x: number) => x < 42 || x > 58;
  const isLeft = (x: number) => x < 50;

  // Classify midfielders for special roles
  const midfielders = onPitch.filter(p => p.currentPitchPosition === "MID");

  // ATTACK: pick one most-central midfielder to push higher (only when 3+ mids)
  let attackPushMidId: string | null = null;
  if (mode === "attack" && midfielders.length >= 3) {
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

  // In defend mode, keep a clear visual channel between defenders and goalkeeper.
  const projectedGoalkeeperY = (() => {
    if (mode !== "defend") return null;
    const gk = onPitch.find(player => player.currentPitchPosition === "GK" && player.position);
    if (!gk) return null;

    let gkY = gk.position!.y + 1; // match defend-mode GK offset
    if (gkY < 20) gkY = 20;
    if (gkY > 84) gkY = 84;
    return gkY;
  })();
  const MIN_DEFENDER_GK_GAP = isSmallSided ? 13 : 14;

  // In attack mode, keep midfield clearly separated from the forward line.
  const projectedDeepestForwardY = (() => {
    if (mode !== "attack") return null;
    const forwards = onPitch.filter(player => player.currentPitchPosition === "FWD" && player.position);
    if (forwards.length === 0) return null;

    const forwardDy = isSmallSided ? -6 : -8;
    return forwards.reduce((deepestY, forward) => {
      let projectedY = forward.position!.y + forwardDy;
      if (projectedY < 20) projectedY = 20;
      if (projectedY > 84) projectedY = 84;
      return Math.max(deepestY, projectedY);
    }, 20);
  })();
  const MIN_MID_FORWARD_GAP = isSmallSided ? 14 : 12;

  for (const p of onPitch) {
    const bx = p.position!.x;
    const pos = p.currentPitchPosition;
    let dx = 0;
    let dy = 0;
    let isAnchor = false;

    if (mode === "attack") {
      switch (pos) {
        case "GK":
          dy = -4; // sweeper-keeper: step off line
          break;
        case "DEF":
          // Back line steps up to compress space; wide defenders spread
          dy = isSmallSided ? -6 : -8;
          if (isWide(bx)) dx = isLeft(bx) ? -8 : 8; // spread wide
          break;
        case "MID":
          // Midfield pushes much higher, noticeably closer to forwards
          dy = isSmallSided ? -12 : -16;
          if (p.id === attackPushMidId) {
            // Central playmaker tucks central
            if (isWide(bx)) dx = isLeft(bx) ? 4 : -4;
          } else {
            // Wide mids spread out significantly
            if (isWide(bx)) dx = isLeft(bx) ? -10 : 10;
          }
          break;
        case "FWD": {
          // Forwards push highest — clear visible jump
          dy = isSmallSided ? -18 : -22;
          const forwards = onPitch.filter(pl => pl.currentPitchPosition === "FWD");
          const fwdSpread = forwards.length <= 2 ? 6 : 12;
          if (isWide(bx)) dx = isLeft(bx) ? -fwdSpread : fwdSpread;
        }
          break;
      }
    } else if (mode === "defend") {
      switch (pos) {
        case "GK":
          dy = 2; // stay deep
          break;
        case "DEF":
          // Defenders drop clearly deeper and tuck in compact
          dy = isSmallSided ? 15 : 18;
          if (isWide(bx)) dx = isLeft(bx) ? 6 : -6; // tuck narrow
          break;
        case "MID":
          // Midfield drops to protect space in front of defenders
          dy = isSmallSided ? 10 : 12;
          if (p.id === anchorMidId) {
            // Anchor stays central
            if (bx < 45) dx = 6;
            else if (bx > 55) dx = -6;
            isAnchor = true;
          } else {
            // Wide mids tuck in
            if (isWide(bx)) dx = isLeft(bx) ? 8 : -8;
          }
          break;
        case "FWD":
          // Forwards drop slightly but remain as outlet
          dy = isSmallSided ? 4 : 6;
          if (isWide(bx)) dx = isLeft(bx) ? 6 : -6; // tuck in
          break;
      }
    }

    if (dx !== 0 || dy !== 0) {
      const baseY = p.position!.y;
      // Clamp so players never go above y=20% (under timer/score overlays) or below y=84%
      const finalY = baseY + dy;
      if (finalY < 20) dy = 20 - baseY;
      if (finalY > 84) dy = 84 - baseY;

      if (mode === "defend" && pos === "DEF" && projectedGoalkeeperY !== null) {
        const maxDefenderY = projectedGoalkeeperY - MIN_DEFENDER_GK_GAP;
        const adjustedY = baseY + dy;
        if (adjustedY > maxDefenderY) {
          dy = maxDefenderY - baseY;
        }
      }

      if (mode === "attack" && pos === "MID" && projectedDeepestForwardY !== null) {
        const minMidY = Math.min(projectedDeepestForwardY + MIN_MID_FORWARD_GAP, 84);
        const adjustedY = baseY + dy;
        if (adjustedY < minMidY) {
          dy = minMidY - baseY;
        }
      }

      // Clamp horizontal to stay within pitch (2%-98%)
      const finalX = bx + dx;
      if (finalX < 2) dx = 2 - bx;
      if (finalX > 98) dx = 98 - bx;
      result.set(p.id, { dx, dy, isAnchor });
    }
  }

  return result;
};

/**
 * Compute a visual offset for the soccer ball so it doesn't overlap with
 * any player's effective (offset-adjusted) position while staying near centre.
 */
export const computeBallOffset = (
  ballPosition: { x: number; y: number },
  players: Player[],
  tacticalOffsets: Map<string, TacticalOffset>,
  mode: TacticalMode,
): { dx: number; dy: number } => {
  if (mode === "neutral") return { dx: 0, dy: 0 };

  // Start with a mode-based nudge to keep ball in a sensible area
  let dy = mode === "attack" ? -4 : 3;
  let dx = 0;

  const bx = ballPosition.x + dx;
  const by = ballPosition.y + dy;

  // Gather effective player positions (base + offset)
  const effectivePositions = players
    .filter(p => p.position !== null)
    .map(p => {
      const off = tacticalOffsets.get(p.id);
      return {
        x: p.position!.x + (off?.dx ?? 0),
        y: p.position!.y + (off?.dy ?? 0),
      };
    });

  // If any player is too close, nudge the ball away
  const MIN_DIST = 6; // percentage points
  for (let attempt = 0; attempt < 5; attempt++) {
    const curX = ballPosition.x + dx;
    const curY = ballPosition.y + dy;
    let tooClose = false;

    for (const ep of effectivePositions) {
      const dist = Math.sqrt((curX - ep.x) ** 2 + (curY - ep.y) ** 2);
      if (dist < MIN_DIST) {
        // Push ball away from the player
        const angle = Math.atan2(curY - ep.y, curX - ep.x);
        dx += Math.cos(angle) * 2;
        dy += Math.sin(angle) * 2;
        tooClose = true;
      }
    }
    if (!tooClose) break;
  }

  // Clamp to keep ball near centre circle area (x: 30-70, y: 35-65)
  const finalX = ballPosition.x + dx;
  const finalY = ballPosition.y + dy;
  if (finalX < 30) dx = 30 - ballPosition.x;
  if (finalX > 70) dx = 70 - ballPosition.x;
  if (finalY < 35) dy = 35 - ballPosition.y;
  if (finalY > 65) dy = 65 - ballPosition.y;

  return { dx, dy };
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
