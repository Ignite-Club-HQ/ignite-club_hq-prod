import { describe, it, expect } from "vitest";
import { validateDrill } from "./drillValidator";
import type { DrillFrame, DrillObject } from "./types";

const MUTED = "#94a3b8";
const ACTIVE = "#38bdf8";

function player(id: string, color: string, x = 50, y = 50): DrillObject {
  return { id, type: "player", x, y, color, label: id.toUpperCase() };
}
function frame(position: number, objects: DrillObject[], annotations: DrillFrame["annotations"] = []): DrillFrame {
  return { id: `f${position}`, position, durationMs: 1000, objects, annotations };
}

describe("rotation-coverage rule", () => {
  it("passes when every waiting player is activated at least once", () => {
    const frames = [
      frame(0, [player("w1", ACTIVE, 50, 30), player("w2", MUTED, 20, 92), player("w3", MUTED, 40, 92)]),
      frame(1, [player("w1", MUTED, 20, 92), player("w2", ACTIVE, 50, 30), player("w3", MUTED, 40, 92)]),
      frame(2, [player("w1", MUTED, 20, 92), player("w2", MUTED, 40, 92), player("w3", ACTIVE, 50, 30)]),
    ];
    const r = validateDrill({ id: "d1", name: "full cycle", frames });
    expect(r.issues.find((i) => i.rule === "rotation-coverage")).toBeUndefined();
  });

  it("flags waiting players that never get a turn", () => {
    const frames = [
      frame(0, [player("w1", ACTIVE, 50, 30), player("w2", MUTED, 20, 92), player("w3", MUTED, 40, 92), player("w4", MUTED, 60, 92)]),
      frame(1, [player("w1", MUTED, 20, 92), player("w2", ACTIVE, 50, 30), player("w3", MUTED, 40, 92), player("w4", MUTED, 60, 92)]),
    ];
    const r = validateDrill({ id: "d2", name: "incomplete cycle", frames });
    const issue = r.issues.find((i) => i.rule === "rotation-coverage");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("w3");
    expect(issue?.message).toContain("w4");
    expect(issue?.message).not.toMatch(/\bw1\b/);
    expect(issue?.message).not.toMatch(/\bw2\b/);
  });

  it("does not flag drills with no waiting players", () => {
    const frames = [frame(0, [player("p1", ACTIVE), player("p2", ACTIVE)])];
    const r = validateDrill({ id: "d3", name: "no bench", frames });
    expect(r.issues.find((i) => i.rule === "rotation-coverage")).toBeUndefined();
  });

  it("treats case-insensitively (W1 same as w1)", () => {
    const frames = [
      frame(0, [player("W1", MUTED, 20, 92)]),
      frame(1, [player("W1", ACTIVE, 50, 30)]),
    ];
    const r = validateDrill({ id: "d4", name: "case", frames });
    expect(r.issues.find((i) => i.rule === "rotation-coverage")).toBeUndefined();
  });
});
