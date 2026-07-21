/**
 * Netball helpers — pure-function test suite.
 *
 * Mirrors the basketball suite, with extras for netball-specific logic:
 *  - SwapFit classification (zone overlap rules)
 *  - suggestQuarterLineup honours preferred positions + fairness
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
  classifySwapFit,
  suggestQuarterLineup,
  isPositionAllowedForPlayer,
  getSubKey,
} from "./netballHelpers";
import {
  NetballPlayer,
  NetballSubEvent,
  Quarter,
  QuarterLineup,
} from "./types";

const mkPlayer = (
  id: string,
  position: NetballPlayer["position"] = null,
  minutesPlayed = 0,
  preferred?: NetballPlayer["preferredPositions"]
): NetballPlayer => ({
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
  position: NetballSubEvent["position"] = "GS",
  flags: Partial<NetballSubEvent> = {}
): NetballSubEvent => ({
  quarter: q,
  time,
  playerOut: mkPlayer(outId, position),
  playerIn: mkPlayer(inId),
  position,
  ...flags,
});

describe("findNextDueSub — N1 cross-quarter scoping", () => {
  it("returns a sub due in the current quarter", () => {
    const plan = [mkSub(2, 120, "a", "b")];
    expect(findNextDueSub(plan, 2, 121)?.playerOut.id).toBe("a");
  });

  it("does NOT cascade un-executed Q1 subs into Q2 (regression guard)", () => {
    const plan = [mkSub(1, 300, "a", "b")];
    expect(findNextDueSub(plan, 2, 0)).toBeUndefined();
    expect(findNextDueSub(plan, 2, 600)).toBeUndefined();
  });

  it("ignores executed and skipped subs", () => {
    const plan = [
      mkSub(1, 60, "a", "b", "GS", { executed: true }),
      mkSub(1, 120, "c", "d", "GS", { skipped: true }),
      mkSub(1, 180, "e", "f"),
    ];
    expect(findNextDueSub(plan, 1, 200)?.playerOut.id).toBe("e");
  });
});

describe("classifySwapFit — court zone rules", () => {
  it("classifies exact preferred-position match", () => {
    const p = mkPlayer("a", null, 0, ["GS"]);
    expect(classifySwapFit(p, "GS")).toBe("exact");
  });

  it("classifies zone overlap as 'zone'", () => {
    // GA can play attack-third + attack-circle, same as GS.
    const ga = mkPlayer("a", null, 0, ["GA"]);
    expect(classifySwapFit(ga, "GS")).toBe("zone");
  });

  it("returns 'any' when no preferred positions are set", () => {
    expect(classifySwapFit(mkPlayer("a"), "GK")).toBe("any");
  });

  it("returns 'violation' when preferred positions share no zone", () => {
    // GK only plays defence — putting them at GS is a violation.
    const gk = mkPlayer("a", null, 0, ["GK"]);
    expect(classifySwapFit(gk, "GS")).toBe("violation");
  });
});

describe("isPositionAllowedForPlayer", () => {
  it("allows any position when player has no preferences", () => {
    expect(isPositionAllowedForPlayer(mkPlayer("a"), "GK")).toBe(true);
  });

  it("allows preferred positions only when preferences are set", () => {
    const p = mkPlayer("a", null, 0, ["GS", "GA"]);
    expect(isPositionAllowedForPlayer(p, "GS")).toBe(true);
    expect(isPositionAllowedForPlayer(p, "GK")).toBe(false);
  });
});

describe("pickLikeForLikeBenchPlayer", () => {
  it("prefers exact preferred-position match", () => {
    const bench = [
      mkPlayer("a", null, 0, ["WD"]),
      mkPlayer("b", null, 0, ["GS"]),
      mkPlayer("c", null, 0, ["GA"]),
    ];
    expect(pickLikeForLikeBenchPlayer("GS", bench)?.id).toBe("b");
  });

  it("falls back to zone overlap when no exact match", () => {
    const bench = [
      mkPlayer("a", null, 0, ["GK"]), // defence only — no overlap with GS
      mkPlayer("b", null, 0, ["GA"]), // overlaps GS via attack-third
    ];
    expect(pickLikeForLikeBenchPlayer("GS", bench)?.id).toBe("b");
  });

  it("excludes injured + explicitly excluded players", () => {
    const bench = [
      { ...mkPlayer("inj", null, 0, ["GS"]), isInjured: true },
      mkPlayer("ok", null, 0, ["GS"]),
    ];
    expect(pickLikeForLikeBenchPlayer("GS", bench)?.id).toBe("ok");
    expect(pickLikeForLikeBenchPlayer("GS", bench, ["ok"])).toBeUndefined();
  });
});

describe("transitionPosition + applyLineup", () => {
  it("stamps lastBenchedAt when going on-court → bench", () => {
    const onCourt = mkPlayer("a", "GS");
    const next = transitionPosition(onCourt, null, 1_700_000_000_000);
    expect(next.position).toBeNull();
    expect(next.lastBenchedAt).toBe(1_700_000_000_000);
  });

  it("clears lastBenchedAt when coming back on", () => {
    const onBench: NetballPlayer = { ...mkPlayer("a"), lastBenchedAt: 123 };
    const next = transitionPosition(onBench, "GA");
    expect(next.position).toBe("GA");
    expect(next.lastBenchedAt).toBeNull();
  });

  it("applyLineup honours assignments + benches the rest", () => {
    const players = [
      mkPlayer("a", "GS"),
      mkPlayer("b", "GA"),
      mkPlayer("c"),
    ];
    const lineup: QuarterLineup = {
      quarter: 2,
      assignments: { GS: "c", GA: "a" },
      createdAt: Date.now(),
    };
    const next = applyLineup(players, lineup);
    expect(next.find((p) => p.id === "c")?.position).toBe("GS");
    expect(next.find((p) => p.id === "a")?.position).toBe("GA");
    expect(next.find((p) => p.id === "b")?.position).toBeNull();
  });
});

describe("Rotation plan generators — honour periodType", () => {
  const makeRoster = (): NetballPlayer[] => [
    mkPlayer("p1", "GS", 0, ["GS"]),
    mkPlayer("p2", "GA", 0, ["GA"]),
    mkPlayer("p3", "WA", 0, ["WA"]),
    mkPlayer("p4", "C", 0, ["C"]),
    mkPlayer("p5", "WD", 0, ["WD"]),
    mkPlayer("p6", "GD", 0, ["GD"]),
    mkPlayer("p7", "GK", 0, ["GK"]),
    mkPlayer("b1", null, 0, ["GS", "GA"]),
    mkPlayer("b2", null, 0, ["WA", "C"]),
  ];

  it("time-based plan stays within visible periods (halves)", () => {
    const plan = generateTimeBasedRotationPlan(makeRoster(), 4, 15, "halves");
    for (const s of plan) expect([1, 3]).toContain(s.quarter);
  });

  it("quarter-break plan skips slot 1 (no pre-tipoff break)", () => {
    const plan = generateQuarterBreakRotationPlan(makeRoster(), 2, "quarters");
    expect(plan.every((s) => s.quarter !== 1)).toBe(true);
  });

  it("quarter-break plan in halves only plans for slot 3", () => {
    const plan = generateQuarterBreakRotationPlan(makeRoster(), 2, "halves");
    for (const s of plan) expect(s.quarter).toBe(3);
  });
});

describe("suggestQuarterLineup — fairness + zone safety", () => {
  it("respects existing locked assignments", () => {
    const players = [
      mkPlayer("a", null, 0, ["GS"]),
      mkPlayer("b", null, 0, ["GS"]),
    ];
    const result = suggestQuarterLineup(players, { GS: "a" });
    expect(result.GS).toBe("a");
  });

  it("never assigns a player to a position that violates their zones", () => {
    const players = [
      mkPlayer("gk-only", null, 0, ["GK"]),
      mkPlayer("gs-only", null, 0, ["GS"]),
    ];
    const result = suggestQuarterLineup(players);
    // gk-only can only land at GK / defence-zone positions.
    expect(result.GS).not.toBe("gk-only");
    expect(result.GK).not.toBe("gs-only");
  });

  it("prefers lower-minutes players when fit is equal", () => {
    const players = [
      mkPlayer("tired", null, 600, ["GS", "GA"]),
      mkPlayer("fresh", null, 0, ["GS", "GA"]),
    ];
    const result = suggestQuarterLineup(players);
    // Both are eligible for GS — fresh wins.
    expect(result.GS).toBe("fresh");
  });
});

describe("getSubKey + getBench / getOnCourt", () => {
  it("getSubKey is stable across object identity", () => {
    const a = mkSub(1, 60, "x", "y", "GS");
    const b = mkSub(1, 60, "x", "y", "GS");
    expect(getSubKey(a)).toBe(getSubKey(b));
  });

  it("partitions on-court and bench", () => {
    const players = [mkPlayer("a", "GS"), mkPlayer("b"), mkPlayer("c", "C")];
    expect(getBench(players).map((p) => p.id)).toEqual(["b"]);
    expect(getOnCourt(players).map((p) => p.id).sort()).toEqual(["a", "c"]);
  });
});
