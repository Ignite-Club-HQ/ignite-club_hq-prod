// Training mode types — drills, frames, objects, annotations.
// Pitch coordinates are 0-100 percentages of the pitch surface (matches existing PitchBoard convention).

export type DrillObjectType =
  | "player"
  | "cone"
  | "mini-goal"
  | "full-goal"
  | "ball";

export type AnnotationType =
  | "arrow-solid"
  | "arrow-dashed"
  | "zone"
  | "text"
  | "step-marker";

export interface DrillObject {
  id: string;
  type: DrillObjectType;
  x: number; // 0-100
  y: number; // 0-100
  rotation?: number;
  label?: string;
  color?: string;
  size?: number; // optional scale multiplier (default 1)
}

export interface ArrowGeometry {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface ZoneGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextGeometry {
  x: number;
  y: number;
  text: string;
}

export interface StepMarkerGeometry {
  x: number;
  y: number;
  number: number;
}

export type AnnotationGeometry =
  | ArrowGeometry
  | ZoneGeometry
  | TextGeometry
  | StepMarkerGeometry;

export interface Annotation {
  id: string;
  type: AnnotationType;
  geometry: AnnotationGeometry;
  style?: {
    color?: string;
    width?: number;
    opacity?: number;
  };
}

export interface DrillFrame {
  id: string;
  position: number;
  durationMs: number;
  notes?: string;
  objects: DrillObject[];
  annotations: Annotation[];
}

export interface DrillMetadata {
  ageGroup?: string;
  focus?: string[];
  durationMinutes?: number;
  playersRequired?: number;
  equipment?: string[];
  coachingPoints?: string[];
  progression?: string;
  regression?: string;
}

export interface Drill {
  id: string;
  name: string;
  metadata: DrillMetadata;
  frames: DrillFrame[];
  visibility: "private" | "team" | "club";
  teamId?: string;
  clubId?: string;
}

// Toolbar tool selection
export type TrainingTool =
  | "select"
  | DrillObjectType
  | AnnotationType;

// Default colors
export const TRAINING_COLORS = {
  player: "#0ea5e9", // sky-500
  ball: "#f5f5f5",
  cone: "#f97316", // orange-500
  goal: "#ffffff",
  arrowSolid: "#fbbf24", // amber-400
  arrowDashed: "#a78bfa", // violet-400
  zone: "#22c55e", // green-500
  text: "#ffffff",
  stepMarker: "#ef4444", // red-500
} as const;
