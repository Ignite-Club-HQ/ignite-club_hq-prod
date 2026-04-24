// Frame-to-frame interpolation for drill playback.
// Objects matched by id across frames are tweened (x, y, rotation).
// Objects only in source fade out; only in target fade in.
// Annotations cross-fade as a whole.

import type {
  Annotation,
  ArrowGeometry,
  DrillFrame,
  DrillObject,
  StepMarkerGeometry,
  TextGeometry,
  ZoneGeometry,
} from "./types";

/** Eased linear interpolation (ease-in-out cubic) */
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export interface InterpolatedObject extends DrillObject {
  /** 0..1 visual opacity (fade in/out for objects only in one frame) */
  opacity: number;
}

export interface InterpolatedAnnotation extends Annotation {
  opacity: number;
}

export interface InterpolatedFrame {
  objects: InterpolatedObject[];
  annotations: InterpolatedAnnotation[];
  notes?: string;
}

/**
 * Compute the visual state at a point between `from` and `to`.
 * `t` is 0..1 (will be eased internally).
 */
export function interpolateFrames(
  from: DrillFrame,
  to: DrillFrame,
  tRaw: number
): InterpolatedFrame {
  const t = ease(Math.max(0, Math.min(1, tRaw)));

  const fromMap = new Map(from.objects.map((o) => [o.id, o]));
  const toMap = new Map(to.objects.map((o) => [o.id, o]));
  const allIds = new Set<string>([...fromMap.keys(), ...toMap.keys()]);

  // Detect "shot/pass" balls: a ball that travels far AND was attached to a
  // player at the start whose ending position diverges from the ball's target.
  // For these, delay the ball so the player visibly "strikes" it before it flies,
  // and keep the shooter planted until the ball has essentially reached goal.
  const movementDelay = new Map<string, number>(); // id -> delayUntilT (0..1)
  const NEAR = 6; // % units considered "at the player's feet"
  const FAR_BALL = 15; // ball must travel at least this far to count as a shot
  const PLAYER_DIVERGE = 12; // player ending must be this far from ball ending
  const BALL_STRIKE_DELAY = 0.35;
  const SHOOTER_HOLD_DELAY = 0.92;
  for (const ball of from.objects) {
    if (ball.type !== "ball") continue;
    const ballTo = toMap.get(ball.id);
    if (!ballTo) continue;
    const ballDist = Math.hypot(ballTo.x - ball.x, ballTo.y - ball.y);
    if (ballDist < FAR_BALL) continue;
    // Find a player co-located with the ball in the source frame
    const owner = from.objects.find(
      (o) =>
        o.type === "player" &&
        Math.hypot(o.x - ball.x, o.y - ball.y) <= NEAR
    );
    if (!owner) continue;
    const ownerTo = toMap.get(owner.id);
    if (!ownerTo) continue;
    // If the player ends near the ball's destination, they're carrying it -> no delay.
    const playerEndVsBallEnd = Math.hypot(
      ownerTo.x - ballTo.x,
      ownerTo.y - ballTo.y
    );
    if (playerEndVsBallEnd < PLAYER_DIVERGE) continue;
    // Ball was struck: hold the ball briefly, and keep the shooter fixed until
    // the ball has effectively arrived.
    movementDelay.set(ball.id, BALL_STRIKE_DELAY);
    movementDelay.set(
      owner.id,
      Math.max(movementDelay.get(owner.id) ?? 0, SHOOTER_HOLD_DELAY)
    );
  }

  const objects: InterpolatedObject[] = [];
  for (const id of allIds) {
    const a = fromMap.get(id);
    const b = toMap.get(id);
    if (a && b) {
      let bt = t;
      const delay = movementDelay.get(id);
      if (delay !== undefined) {
        // Hold at source until tRaw passes `delay`, then ease to target over the remainder.
        const rawT = Math.max(0, Math.min(1, tRaw));
        bt = rawT <= delay ? 0 : ease((rawT - delay) / (1 - delay));
      }
      objects.push({
        ...b,
        x: lerp(a.x, b.x, bt),
        y: lerp(a.y, b.y, bt),
        rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, bt),
        size: lerp(a.size ?? 1, b.size ?? 1, bt),
        opacity: 1,
      });
    } else if (a && !b) {
      objects.push({ ...a, opacity: 1 - t });
    } else if (b && !a) {
      objects.push({ ...b, opacity: t });
    }
  }

  // Cross-fade annotations: from fades out, to fades in.
  const annotations: InterpolatedAnnotation[] = [];
  for (const ann of from.annotations) {
    annotations.push({ ...ann, opacity: 1 - t });
  }
  for (const ann of to.annotations) {
    annotations.push({ ...ann, opacity: t });
  }

  return { objects, annotations, notes: t < 0.5 ? from.notes : to.notes };
}

/** A single frame as the "live" interpolated view (everything fully opaque). */
export function staticFrame(frame: DrillFrame): InterpolatedFrame {
  return {
    objects: frame.objects.map((o) => ({ ...o, opacity: 1 })),
    annotations: frame.annotations.map((a) => ({ ...a, opacity: 1 })),
    notes: frame.notes,
  };
}

// Re-export geometry helpers for thumbnail renderer convenience
export type {
  ArrowGeometry,
  StepMarkerGeometry,
  TextGeometry,
  ZoneGeometry,
};
