// Cycle player chips between rotations of a drill so each player advances to
// the next player's starting spot at the end of each loop iteration.
//
// "Rotation order" follows the same canonical squad order used by
// teamPlayerSubstitution: attackers (sky-blue / unset) first, defenders (red),
// then everything else (servers / GKs / coaches). Within each bucket, the
// authored player ordering is preserved.
//
// The rotation only affects player x/y positions; labels, ids and other props
// stay attached to the same chip so the on-pitch chip remains "the same player"
// throughout playback.

import type { DrillFrame, DrillObject } from "./types";

function bucket(o: DrillObject): 0 | 1 | 2 {
  if (!o.color || o.color === "#0ea5e9") return 0;
  if (o.color === "#ef4444") return 1;
  return 2;
}

/** Stable canonical ordering of player objects across all frames of a drill. */
function canonicalPlayerOrder(frames: DrillFrame[]): string[] {
  const first = frames[0];
  if (!first) return [];
  const players = first.objects.filter((o) => o.type === "player");
  return [...players]
    .sort((a, b) => bucket(a) - bucket(b))
    .map((p) => p.id);
}

/**
 * Returns the player chips' (x, y) coordinates from the first frame of the
 * drill, indexed by chip id. These define each "rotation slot".
 */
function frameZeroSlots(
  frames: DrillFrame[]
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  const first = frames[0];
  if (!first) return map;
  for (const o of first.objects) {
    if (o.type === "player") map.set(o.id, { x: o.x, y: o.y });
  }
  return map;
}

/**
 * Build a synthetic "rotation transition" frame to append to the sequence.
 * It is a copy of `lastFrame` but with player chips moved to the NEXT player's
 * frame-0 position so playback animates the swap. Non-player objects mirror
 * frame 0 so the next iteration starts cleanly.
 */
export function buildRotationFrame(
  frames: DrillFrame[],
  cycleStep: number
): DrillFrame | null {
  if (frames.length < 2) return null;
  const order = canonicalPlayerOrder(frames);
  if (order.length < 2) return null;

  const slots = frameZeroSlots(frames);
  const lastFrame = frames[frames.length - 1];
  const firstFrame = frames[0];

  // Map each player id -> the slot of the player that comes `cycleStep + 1`
  // positions ahead in the canonical order. Players land in the next slot.
  const targetSlot = new Map<string, { x: number; y: number }>();
  const n = order.length;
  for (let i = 0; i < n; i++) {
    const fromId = order[i];
    const toId = order[(i + cycleStep + 1) % n];
    const slot = slots.get(toId);
    if (slot) targetSlot.set(fromId, slot);
  }

  const rotatedPlayers: DrillObject[] = lastFrame.objects
    .filter((o) => o.type === "player")
    .map((o) => {
      const dest = targetSlot.get(o.id);
      if (!dest) return o;
      return { ...o, x: dest.x, y: dest.y };
    });

  // Non-player props mirror frame 0 so the next iteration's frame 0 lines up.
  const nonPlayerProps = firstFrame.objects.filter((o) => o.type !== "player");

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
 * Return the input frames with a rotation transition appended at the end.
 * Used by the playback hook when looping is enabled and the drill has at least
 * 2 players, so each loop iteration ends with a visible rotation step.
 */
export function withRotationTransition(
  frames: DrillFrame[],
  cycleStep: number
): DrillFrame[] {
  const rotation = buildRotationFrame(frames, cycleStep);
  if (!rotation) return frames;
  return [...frames, rotation];
}
