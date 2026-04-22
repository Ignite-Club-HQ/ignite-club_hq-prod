import { describe, it, expect } from "vitest";
import {
  frameRowToFrame,
  rowToDrill,
  type DrillFrameRow,
  type DrillRow,
} from "../drillStorage";
import type { Annotation, DrillObject } from "../types";

/**
 * Snapshot tests for the DB row → Drill model mapping.
 *
 * Locks the contract between the `drills` / `drill_frames` tables and the
 * in-app `Drill` / `DrillFrame` types. If a Supabase migration renames or
 * reshapes a column, or if the mapping logic drifts, these snapshots will
 * fail loudly instead of silently rendering broken drills.
 *
 * Snapshots are intentionally hand-shaped (not generated values) so a diff
 * is human-readable.
 */

const SAMPLE_OBJECTS: DrillObject[] = [
  { id: "p1", type: "player", x: 50, y: 80, rotation: 0, label: "1", color: "#0ea5e9", size: 1 },
  { id: "p2", type: "player", x: 35, y: 60, rotation: 0, label: "2", color: "#0ea5e9", size: 1 },
  { id: "b1", type: "ball", x: 50, y: 80, rotation: 0, color: "#f5f5f5", size: 1 },
  { id: "c1", type: "cone", x: 50, y: 30, rotation: 0, color: "#f97316", size: 1 },
];

const SAMPLE_ANNOTATIONS: Annotation[] = [
  {
    id: "a1",
    type: "arrow-solid",
    geometry: { from: { x: 50, y: 80 }, to: { x: 35, y: 60 } },
    style: { color: "#fbbf24", width: 2 },
  },
  {
    id: "a2",
    type: "arrow-dashed",
    geometry: { from: { x: 35, y: 60 }, to: { x: 50, y: 30 } },
    style: { color: "#a78bfa", width: 2 },
  },
  {
    id: "s1",
    type: "step-marker",
    geometry: { x: 42, y: 70, number: 1 },
    style: { color: "#ef4444" },
  },
];

const FRAME_ROW: DrillFrameRow = {
  id: "frame-1",
  drill_id: "drill-1",
  position: 0,
  duration_ms: 1500,
  notes: "Players pass through the cone.",
  objects: SAMPLE_OBJECTS,
  annotations: SAMPLE_ANNOTATIONS,
};

const DRILL_ROW: DrillRow = {
  id: "drill-1",
  owner_user_id: "user-1",
  team_id: null,
  club_id: null,
  name: "Pass and Move",
  description: "Short passing into space",
  age_group: "U10",
  focus: ["passing", "movement"],
  duration_minutes: 12,
  players_required: 6,
  equipment: ["6 cones", "2 balls"],
  coaching_points: ["Open body shape", "Scan before receiving"],
  progression: "Add a defender",
  regression: "Reduce playing area",
  tags: [],
  visibility: "official",
  pitch_size: "third",
  thumbnail_url: null,
  is_official: true,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

describe("drillStorage mapping (snapshots)", () => {
  it("maps a frame row → DrillFrame with arrow geometry preserved", () => {
    expect(frameRowToFrame(FRAME_ROW)).toMatchInlineSnapshot(`
      {
        "annotations": [
          {
            "geometry": {
              "from": {
                "x": 50,
                "y": 80,
              },
              "to": {
                "x": 35,
                "y": 60,
              },
            },
            "id": "a1",
            "style": {
              "color": "#fbbf24",
              "width": 2,
            },
            "type": "arrow-solid",
          },
          {
            "geometry": {
              "from": {
                "x": 35,
                "y": 60,
              },
              "to": {
                "x": 50,
                "y": 30,
              },
            },
            "id": "a2",
            "style": {
              "color": "#a78bfa",
              "width": 2,
            },
            "type": "arrow-dashed",
          },
          {
            "geometry": {
              "number": 1,
              "x": 42,
              "y": 70,
            },
            "id": "s1",
            "style": {
              "color": "#ef4444",
            },
            "type": "step-marker",
          },
        ],
        "durationMs": 1500,
        "id": "frame-1",
        "notes": "Players pass through the cone.",
        "objects": [
          {
            "color": "#0ea5e9",
            "id": "p1",
            "label": "1",
            "rotation": 0,
            "size": 1,
            "type": "player",
            "x": 50,
            "y": 80,
          },
          {
            "color": "#0ea5e9",
            "id": "p2",
            "label": "2",
            "rotation": 0,
            "size": 1,
            "type": "player",
            "x": 35,
            "y": 60,
          },
          {
            "color": "#f5f5f5",
            "id": "b1",
            "rotation": 0,
            "size": 1,
            "type": "ball",
            "x": 50,
            "y": 80,
          },
          {
            "color": "#f97316",
            "id": "c1",
            "rotation": 0,
            "size": 1,
            "type": "cone",
            "x": 50,
            "y": 30,
          },
        ],
        "position": 0,
      }
    `);
  });

  it("maps an official drill row → Drill (visibility collapses to 'club')", () => {
    const drill = rowToDrill(DRILL_ROW, [frameRowToFrame(FRAME_ROW)]);
    // visibility: official → club is a deliberate policy boundary; lock it.
    expect(drill.visibility).toBe("club");
    expect(drill).toMatchSnapshot();
  });

  it("falls back to empty arrays when DB columns are null/non-array", () => {
    const broken: DrillFrameRow = {
      ...FRAME_ROW,
      objects: null as unknown as DrillFrameRow["objects"],
      annotations: "not-an-array" as unknown as DrillFrameRow["annotations"],
      notes: null,
    };
    const frame = frameRowToFrame(broken);
    expect(frame.objects).toEqual([]);
    expect(frame.annotations).toEqual([]);
    expect(frame.notes).toBeUndefined();
  });
});
