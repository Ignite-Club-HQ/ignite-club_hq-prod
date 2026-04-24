// Normalize a drill's frames so that every persistent chip that appears
// anywhere in the drill is present in EVERY frame. When a chip is missing
// from a frame, we fill it in by carrying forward its most recent known
// state (or, if it hasn't appeared yet, by reaching forward to its first
// authored position).
//
// This fixes the "vanishing chip" bug seen in legacy drills where authors
// (or seed scripts) only placed chips into a subset of frames. Without
// this, those chips fade out during playback and pop back in later, which
// looks like they "disappeared".
//
// Persistent chip types: players, balls, cones, mini-goals, full-goals,
// goalkeepers — anything physically on the pitch.
// Non-persistent: annotations like arrows are frame-scoped by design and
// remain authored per-frame (they're carried via `annotations`, not
// `objects`, so this filter is just a belt-and-braces guard).

import type { DrillFrame, DrillObject } from "./types";

const PERSISTENT_TYPES = new Set([
  "player",
  "goalkeeper",
  "ball",
  "cone",
  "mini-goal",
  "full-goal",
  "goal-full",
  "goal",
  "marker",
  "flag",
]);

/** Returns true if the object is a chip that should persist across frames. */
function isPersistentPlayer(o: DrillObject): boolean {
  return PERSISTENT_TYPES.has(o.type as string);
}

export function normalizeFramesForPlayback(frames: DrillFrame[]): DrillFrame[] {
  if (frames.length < 2) return frames;

  // Collect canonical player ids in order of first appearance, and remember
  // the last authored snapshot of each chip up to (and including) each frame.
  const allPlayerIds: string[] = [];
  const seenIds = new Set<string>();
  for (const f of frames) {
    for (const o of f.objects) {
      if (isPersistentPlayer(o) && !seenIds.has(o.id)) {
        seenIds.add(o.id);
        allPlayerIds.push(o.id);
      }
    }
  }
  if (allPlayerIds.length === 0) return frames;

  // Pre-compute, for every player id, the first frame index where it appears
  // and a snapshot of that authored chip — used to back-fill frames BEFORE
  // the chip was authored in the timeline.
  const firstAppearance = new Map<string, { idx: number; obj: DrillObject }>();
  for (let i = 0; i < frames.length; i++) {
    for (const o of frames[i].objects) {
      if (isPersistentPlayer(o) && !firstAppearance.has(o.id)) {
        firstAppearance.set(o.id, { idx: i, obj: o });
      }
    }
  }

  // Walk forward, maintaining the most recent authored snapshot per chip id.
  const lastSeen = new Map<string, DrillObject>();
  const out: DrillFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const presentIds = new Set<string>();
    const nextObjects: DrillObject[] = [];

    for (const o of frame.objects) {
      nextObjects.push(o);
      if (isPersistentPlayer(o)) {
        lastSeen.set(o.id, o);
        presentIds.add(o.id);
      }
    }

    // For every canonical player not authored in this frame, inject a held
    // snapshot so the chip stays on-pitch instead of vanishing.
    for (const id of allPlayerIds) {
      if (presentIds.has(id)) continue;
      const held = lastSeen.get(id);
      if (held) {
        // Carry forward: chip already appeared earlier; freeze it in place.
        nextObjects.push({ ...held });
      } else {
        // Chip hasn't appeared yet — back-fill from its first authored frame
        // so it's already on-pitch (in its starting spot) before its
        // authored entrance, instead of popping in.
        const first = firstAppearance.get(id);
        if (first) nextObjects.push({ ...first.obj });
      }
    }

    out.push({ ...frame, objects: nextObjects });
  }
  return out;
}
