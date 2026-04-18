/**
 * Basketball helpers — pure-function test suite.
 *
 * Locks in correctness of the bits the audits keep finding regressions in:
 *  - findNextDueSub scoping (B1: no cross-quarter cascade)
 *  - pickLikeForLikeBenchPlayer fairness (lowest-minutes wins)
 *  - applyLineup transitions (lastBenchedAt stamping)
 *  - Rotation plan generation honouring periodType
 */
import { describe, expect, it } from "vitest";
import {
  findNextDueSub,
  pickLikeForLikeBenchPlayer,
  applyLineup,
  generateTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan,
  getBench,
  getOnCourt,
  transitionPosition,
  getSubKey,
} from "./basketballHelpers";
import {
  BasketballPlayer,
  BasketballSubEvent,
  Quarter,
  QuarterLineup,
} from "./types";

const mkPlayer = (
  id: string,
  position: BasketballPlayer["position"] = null,
  minutesPlayed = 0,
  preferred?: BasketballPlayer["preferredPositions"]
): BasketballPlayer => ({
  id,
  name: `Player ${id}`,
  position,
  minutesPlayed,
  preferredPositions: preferred,
});

const mkSub = (
  q: Quarter,
  time: number,
  outId: string,
  inId: string,
  position: BasketballSubEvent["position"] = "PG",
  flags: Partial<BasketballSubEvent> = {}
): BasketballSubEvent => ({
  quarter: q,
  time,
  playerOut: mkPlayer(outId, position),
  playerIn: mkPlayer(inId),
  position,
  ...flags,
});

describe("findNextDueSub — B1/N1 cross-quarter scoping", () => {
  it("returns a sub due in the current quarter", () => {
    const plan = [mkSub(2, 120, "a", "b")];
    const due = findNextDueSub(plan, 2, 121);
    expect(due?.playerOut.id).toBe("a");
  });

  it("does NOT cascade un-executed Q1 subs into Q2 (regression guard)", () => {
    // A sub planned at Q1 5:00 that never fired must not auto-fire in Q2.
    const plan = [mkSub(1, 300, "a", "b")];
    expect(findNextDueSub(plan, 2, 0)).toBeUndefined();
    expect(findNextDueSub(plan, 2, 600)).toBeUndefined();
  });

  it("ignores executed and skipped subs", () => {
    const plan = [
      mkSub(1, 60, "a", "b", "PG", { executed: true }),
      mkSub(1, 120, "c", "d", "PG", { skipped: true }),
      mkSub(1, 180, "e", "f"),
    ];
    expect(findNextDueSub(plan, 1, 200)?.playerOut.id).toBe("e");
  });

  it("returns undefined when nothing is due yet", () => {
    const plan = [mkSub(1, 300, "a", "b")];
    expect(findNextDueSub(plan, 1, 100)).toBeUndefined();
  });
});

describe("pickLikeForLikeBenchPlayer — fairness + eligibility", () => {
  const bench = [
    mkPlayer("low", null, 60, ["PG"]),
    mkPlayer("mid", null, 120, ["PG"]),
    mkPlayer("high", null, 240, ["PG"]),
  ];

  it("prefers the lowest-minutes preferred-position player", () => {
    const pick = pickLikeForLikeBenchPlayer("PG", bench);
    expect(pick?.id).toBe("low");
  });

  it("falls back to lowest-minutes when no preferred match", () => {
    const generic = [
      mkPlayer("a", null, 240),
      mkPlayer("b", null, 60),
      mkPlayer("c", null, 180),
    ];
    expect(pickLikeForLikeBenchPlayer("C", generic)?.id).toBe("b");
  });

  it("excludes injured / fouled-out / explicitly excluded players", () => {
    const pool = [
      { ...mkPlayer("inj", null, 0), isInjured: true },
      { ...mkPlayer("fo", null, 0), isFouledOut: true },
      mkPlayer("ok", null, 200),
    ];
    expect(pickLikeForLikeBenchPlayer("PG", pool)?.id).toBe("ok");
    expect(pickLikeForLikeBenchPlayer("PG", pool, ["ok"])).toBeUndefined();
  });

  it("returns undefined for an empty bench", () => {
    expect(pickLikeForLikeBenchPlayer("PG", [])).toBeUndefined();
  });
});

describe("transitionPosition + applyLineup", () => {
  it("stamps lastBenchedAt when going on-court → bench", () => {
    const onCourt = mkPlayer("a", "PG");
    const next = transitionPosition(onCourt, null, 1_700_000_000_000);
    expect(next.position).toBeNull();
    expect(next.lastBenchedAt).toBe(1_700_000_000_000);
  });

  it("clears lastBenchedAt when coming back on", () => {
    const onBench: BasketballPlayer = { ...mkPlayer("a"), lastBenchedAt: 123 };
    const next = transitionPosition(onBench, "SG");
    expect(next.position).toBe("SG");
    expect(next.lastBenchedAt).toBeNull();
  });

  it("applyLineup moves named players on-court and benches the rest", () => {
    const players = [
      mkPlayer("a", "PG"),
      mkPlayer("b", "SG"),
      mkPlayer("c"), // bench
    ];
    const lineup: QuarterLineup = {
      quarter: 2,
      assignments: { PG: "c", SG: "a" }, // b is dropped
      createdAt: Date.now(),
    };
    const next = applyLineup(players, lineup);
    expect(next.find((p) => p.id === "c")?.position).toBe("PG");
    expect(next.find((p) => p.id === "a")?.position).toBe("SG");
    expect(next.find((p) => p.id === "b")?.position).toBeNull();
  });
});

describe("Rotation plan generators — honour periodType", () => {
  const makeRoster = (): BasketballPlayer[] => [
    mkPlayer("p1", "PG", 0, ["PG"]),
    mkPlayer("p2", "SG", 0, ["SG"]),
    mkPlayer("p3", "SF", 0, ["SF"]),
    mkPlayer("p4", "PF", 0, ["PF"]),
    mkPlayer("p5", "C", 0, ["C"]),
    mkPlayer("b1", null, 0, ["PG"]),
    mkPlayer("b2", null, 0, ["SG"]),
  ];

  it("time-based plan only schedules within visible periods (halves)", () => {
    const plan = generateTimeBasedRotationPlan(makeRoster(), 4, 10, "halves");
    const quarters = new Set(plan.map((s) => s.quarter));
    // halves mode → only slots 1 and 3 are valid.
    for (const q of quarters) {
      expect([1, 3]).toContain(q);
    }
  });

  it("time-based plan covers all 4 quarters by default", () => {
    const plan = generateTimeBasedRotationPlan(makeRoster(), 4, 10, "quarters");
    const quarters = new Set(plan.map((s) => s.quarter));
    expect(quarters.size).toBeGreaterThan(1);
    for (const q of quarters) expect([1, 2, 3, 4]).toContain(q);
  });

  it("quarter-break plan skips the first period (no break before tipoff)", () => {
    const plan = generateQuarterBreakRotationPlan(makeRoster(), 2, "quarters");
    expect(plan.every((s) => s.quarter !== 1)).toBe(true);
  });

  it("quarter-break plan in halves only plans for slot 3 (H2 break)", () => {
    const plan = generateQuarterBreakRotationPlan(makeRoster(), 2, "halves");
    for (const s of plan) expect(s.quarter).toBe(3);
  });
});

describe("getSubKey + getBench / getOnCourt", () => {
  it("getSubKey is stable across object identity", () => {
    const a = mkSub(1, 60, "x", "y", "PG");
    const b = mkSub(1, 60, "x", "y", "PG");
    expect(getSubKey(a)).toBe(getSubKey(b));
  });

  it("getBench / getOnCourt partition correctly", () => {
    const players = [mkPlayer("a", "PG"), mkPlayer("b"), mkPlayer("c", "C")];
    expect(getBench(players).map((p) => p.id)).toEqual(["b"]);
    expect(getOnCourt(players).map((p) => p.id).sort()).toEqual(["a", "c"]);
  });
});
