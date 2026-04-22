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

const ATTACKER = "#0ea5e9";
const DEFENDER = "#ef4444";

function arrow(id: string, fromX: number, fromY: number, toX: number, toY: number) {
  return {
    id,
    type: "arrow-solid" as const,
    geometry: { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } },
  };
}

describe("contest-fairness rule", () => {
  it("flags 1v1 contest drills where the attacker always wins", () => {
    // Attacker (sky) drives at goal (low y) in every frame, defender just
    // shifts a tiny bit. No defender clearance arrow anywhere.
    const frames = [
      frame(0, [
        { id: "a", type: "player", x: 50, y: 70, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 50, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 50, y: 71, color: "#fff" },
      ]),
      frame(1, [
        { id: "a", type: "player", x: 50, y: 40, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 45, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 50, y: 20, color: "#fff" },
      ], [arrow("ar1", 50, 70, 50, 15)]), // attacker shoots at goal
    ];
    const r = validateDrill({ id: "cf1", name: "always attacker wins", frames });
    const issue = r.issues.find((i) => i.rule === "contest-fairness");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toMatch(/attacker wins every rep|outcomes should rotate/i);
  });

  it("passes when at least one frame shows the defender clearing the ball", () => {
    const frames = [
      frame(0, [
        { id: "a", type: "player", x: 50, y: 70, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 50, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 50, y: 71, color: "#fff" },
      ], [arrow("ar1", 50, 70, 50, 15)]),
      // Alternate-outcome frame: defender clears ball away from goal (dy big & positive)
      frame(1, [
        { id: "a", type: "player", x: 50, y: 60, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 50, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 30, y: 85, color: "#fff" },
      ], [arrow("ar2", 50, 50, 30, 85)]),
    ];
    const r = validateDrill({ id: "cf2", name: "rotated outcomes", frames });
    expect(r.issues.find((i) => i.rule === "contest-fairness")).toBeUndefined();
  });

  it("does not apply to drills without both an attacker and defender", () => {
    // Attacker only — passing/dribbling drill, not a contest.
    const frames = [
      frame(0, [
        { id: "a", type: "player", x: 50, y: 70, color: ATTACKER, label: "A" },
        { id: "b", type: "ball", x: 50, y: 71, color: "#fff" },
      ], [arrow("ar1", 50, 70, 50, 20)]),
      frame(1, [
        { id: "a", type: "player", x: 50, y: 30, color: ATTACKER, label: "A" },
        { id: "b", type: "ball", x: 50, y: 20, color: "#fff" },
      ]),
    ];
    const r = validateDrill({ id: "cf3", name: "no defender", frames });
    expect(r.issues.find((i) => i.rule === "contest-fairness")).toBeUndefined();
  });

  it("ignores attacker arrows — only defender-anchored clearances count", () => {
    // Attacker arrow goes downward (toward own goal) — should NOT count as defender clearance.
    const frames = [
      frame(0, [
        { id: "a", type: "player", x: 50, y: 30, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 60, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 50, y: 30, color: "#fff" },
      ], [arrow("ar1", 50, 30, 50, 80)]), // attacker passes backwards — not a defender clearance
      frame(1, [
        { id: "a", type: "player", x: 50, y: 30, color: ATTACKER, label: "A" },
        { id: "d", type: "player", x: 50, y: 60, color: DEFENDER, label: "D" },
        { id: "b", type: "ball", x: 50, y: 80, color: "#fff" },
      ]),
    ];
    const r = validateDrill({ id: "cf4", name: "attacker-only arrow", frames });
    expect(r.issues.find((i) => i.rule === "contest-fairness")).toBeDefined();
  });

  it("ignores drills where the defender chip only appears in a single frame (coach cue)", () => {
    // Warm-up where a red 'coach' chip only shows for one frame as a colour signal,
    // not a sustained contest. Should NOT trigger contest-fairness.
    const frames = [
      frame(0, [
        { id: "a", type: "player", x: 50, y: 50, color: ATTACKER, label: "1" },
        { id: "b", type: "ball", x: 50, y: 51, color: "#fff" },
      ]),
      frame(1, [
        { id: "a", type: "player", x: 50, y: 40, color: ATTACKER, label: "1" },
        { id: "b", type: "ball", x: 50, y: 40, color: "#fff" },
      ]),
      frame(2, [
        { id: "a", type: "player", x: 50, y: 30, color: ATTACKER, label: "1" },
        // single-frame red signal chip
        { id: "sig", type: "player", x: 10, y: 10, color: DEFENDER, label: "RED" },
        { id: "b", type: "ball", x: 50, y: 30, color: "#fff" },
      ]),
    ];
    const r = validateDrill({ id: "cf5", name: "warm-up with red signal", frames });
    expect(r.issues.find((i) => i.rule === "contest-fairness")).toBeUndefined();
  });
});
