// Cycle player chips between rotations of a drill so each player advances to
// the next player's starting spot at the end of each loop iteration.
//
// "Rotation order" follows the same canonical squad order used by
// teamPlayerSubstitution: attackers (sky-blue / unset) first, defenders (red),
// then everything else (servers / GKs / coaches). Within each bucket the
// authored ordering is preserved.
//
// The rotation only affects player x/y positions; chip ids, labels and colors
// stay constant so on-pitch identity is preserved across iterations.

import type { DrillFrame, DrillObject } from "./types";

function bucket(o: DrillObject): 0 | 1 | 2 {
  if (!o.color || o.color === "#0ea5e9") return 0;
  if (o.color === "#ef4444") return 1;
  return 2;
}

/** Stable canonical ordering of player chip ids across all frames. */
function canonicalPlayerOrder(frames: DrillFrame[]): string[] {
  const first = frames[0];
  if (!first) return [];
  const players = first.objects.filter((o) => o.type === "player");
  return [...players]
    .sort((a, b) => bucket(a) - bucket(b))
    .map((p) => p.id);
}

/**
 * Remap player roles across every frame by `cycleStep` positions in canonical
 * order. The chip with id `order[i]` adopts the trajectory the chip
 * `order[(i + cycleStep) % n]` had in the original drill, while keeping its
 * own identity (id/label/color). cycleStep === 0 returns frames unchanged.
 */
function rotatePlayerRoles(
  frames: DrillFrame[],
  cycleStep: number
): DrillFrame[] {
  const order = canonicalPlayerOrder(frames);
  const n = order.length;
  if (n < 2 || cycleStep % n === 0) return frames;

  return frames.map((frame) => {
    const playersById = new Map<string, DrillObject>();
    for (const obj of frame.objects) {
      if (obj.type === "player") playersById.set(obj.id, obj);
    }

    const remapped: DrillObject[] = [];
    for (let i = 0; i < n; i++) {
      const id = order[i];
      const sourceId = order[(i + cycleStep) % n];
      const source = playersById.get(sourceId);
      const own = playersById.get(id);
      if (!own) continue;
      if (!source) {
        remapped.push(own);
        continue;
      }
      remapped.push({
        ...own,
        x: source.x,
        y: source.y,
        rotation: source.rotation,
        size: source.size,
      });
    }

    const nonPlayers = frame.objects.filter((o) => o.type !== "player");
    return { ...frame, objects: [...remapped, ...nonPlayers] };
  });
}

/**
 * Build a synthetic "rotation transition" frame that animates each chip from
 * its position at the end of cycle `cycleStep` to where it will sit at the
 * start of cycle `cycleStep + 1`. Non-player props mirror the next cycle's
 * frame 0 so the iteration boundary is seamless.
 */
function buildRotationFrame(
  rotatedFrames: DrillFrame[],
  nextCycleFrame0: DrillFrame,
  cycleStep: number
): DrillFrame | null {
  if (rotatedFrames.length < 1) return null;
  const lastFrame = rotatedFrames[rotatedFrames.length - 1];

  const nextPlayerSlots = new Map<string, { x: number; y: number }>();
  for (const obj of nextCycleFrame0.objects) {
    if (obj.type === "player") {
      nextPlayerSlots.set(obj.id, { x: obj.x, y: obj.y });
    }
  }
  if (nextPlayerSlots.size === 0) return null;

  const rotatedPlayers: DrillObject[] = lastFrame.objects
    .filter((o) => o.type === "player")
    .map((o) => {
      const dest = nextPlayerSlots.get(o.id);
      if (!dest) return o;
      return { ...o, x: dest.x, y: dest.y };
    });

  const nonPlayerProps = nextCycleFrame0.objects.filter(
    (o) => o.type !== "player"
  );

  return {
    id: `__rotation_transition_${cycleStep}`,
    position: lastFrame.position + 1,
    durationMs: Math.max(1200, Math.round((lastFrame.durationMs || 1500) * 1.2)),
    notes: "↻ Rotate to next position",
    objects: [...rotatedPlayers, ...nonPlayerProps],
    annotations: [],
  };
}

/**
 * Return the drill frames for cycle `cycleStep`, with a rotation transition
 * appended at the end that moves players into their cycle `cycleStep + 1`
 * starting positions. If the drill has fewer than 2 players or 2 frames,
 * the input is returned unchanged.
 */
export function withRotationTransition(
  rawFrames: DrillFrame[],
  cycleStep: number
): DrillFrame[] {
  if (rawFrames.length < 2) return rawFrames;
  const order = canonicalPlayerOrder(rawFrames);
  if (order.length < 2) return rawFrames;

  const rotated = rotatePlayerRoles(rawFrames, cycleStep);
  const nextRotated = rotatePlayerRoles(rawFrames, cycleStep + 1);
  const nextFrame0 = nextRotated[0];
  if (!nextFrame0) return rotated;

  const transition = buildRotationFrame(rotated, nextFrame0, cycleStep);
  if (!transition) return rotated;
  return [...rotated, transition];
}
