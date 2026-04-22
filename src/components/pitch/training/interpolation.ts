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

  const objects: InterpolatedObject[] = [];
  for (const id of allIds) {
    const a = fromMap.get(id);
    const b = toMap.get(id);
    if (a && b) {
      objects.push({
        ...b,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, t),
        size: lerp(a.size ?? 1, b.size ?? 1, t),
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
