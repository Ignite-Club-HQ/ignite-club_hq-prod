import {
  Annotation,
  AnnotationType,
  DrillFrame,
  DrillObject,
  DrillObjectType,
  TRAINING_COLORS,
} from "./types";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createObject(
  type: DrillObjectType,
  x: number,
  y: number,
  overrides: Partial<DrillObject> = {}
): DrillObject {
  const base: DrillObject = {
    id: uid(),
    type,
    x,
    y,
    rotation: 0,
    size: 1,
  };
  if (type === "player") {
    base.color = TRAINING_COLORS.player;
    base.label = overrides.label ?? "P";
  } else if (type === "ball") {
    base.color = TRAINING_COLORS.ball;
  } else if (type === "cone") {
    base.color = TRAINING_COLORS.cone;
  } else if (type === "mini-goal" || type === "full-goal") {
    base.color = TRAINING_COLORS.goal;
  }
  return { ...base, ...overrides };
}

export function createAnnotation(
  type: AnnotationType,
  x: number,
  y: number,
  options: { stepNumber?: number; text?: string } = {}
): Annotation {
  const id = uid();
  switch (type) {
    case "arrow-solid":
      return {
        id,
        type,
        geometry: { from: { x, y }, to: { x: Math.min(100, x + 12), y } },
        style: { color: TRAINING_COLORS.arrowSolid, width: 2 },
      };
    case "arrow-dashed":
      return {
        id,
        type,
        geometry: { from: { x, y }, to: { x: Math.min(100, x + 12), y } },
        style: { color: TRAINING_COLORS.arrowDashed, width: 2 },
      };
    case "zone":
      return {
        id,
        type,
        geometry: {
          x: Math.max(0, x - 8),
          y: Math.max(0, y - 6),
          width: 16,
          height: 12,
        },
        style: { color: TRAINING_COLORS.zone, opacity: 0.25 },
      };
    case "text":
      return {
        id,
        type,
        geometry: { x, y, text: options.text ?? "Note" },
        style: { color: TRAINING_COLORS.text },
      };
    case "step-marker":
      return {
        id,
        type,
        geometry: { x, y, number: options.stepNumber ?? 1 },
        style: { color: TRAINING_COLORS.stepMarker },
      };
  }
}

export function cloneObject(obj: DrillObject, dx = 4, dy = 4): DrillObject {
  return {
    ...obj,
    id: uid(),
    x: Math.min(100, Math.max(0, obj.x + dx)),
    y: Math.min(100, Math.max(0, obj.y + dy)),
  };
}

export function cloneAnnotation(ann: Annotation, dx = 4, dy = 4): Annotation {
  const id = uid();
  switch (ann.type) {
    case "arrow-solid":
    case "arrow-dashed": {
      const g = ann.geometry as { from: { x: number; y: number }; to: { x: number; y: number } };
      return {
        ...ann,
        id,
        geometry: {
          from: { x: g.from.x + dx, y: g.from.y + dy },
          to: { x: g.to.x + dx, y: g.to.y + dy },
        },
      };
    }
    case "zone": {
      const g = ann.geometry as { x: number; y: number; width: number; height: number };
      return { ...ann, id, geometry: { ...g, x: g.x + dx, y: g.y + dy } };
    }
    case "text": {
      const g = ann.geometry as { x: number; y: number; text: string };
      return { ...ann, id, geometry: { ...g, x: g.x + dx, y: g.y + dy } };
    }
    case "step-marker": {
      const g = ann.geometry as { x: number; y: number; number: number };
      return { ...ann, id, geometry: { ...g, x: g.x + dx, y: g.y + dy } };
    }
  }
}

export function createEmptyFrame(position: number, durationMs = 1500): DrillFrame {
  return {
    id: uid(),
    position,
    durationMs,
    notes: "",
    objects: [],
    annotations: [],
  };
}

export { uid };
