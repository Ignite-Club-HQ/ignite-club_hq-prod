import { describe, expect, it } from "vitest";
import { createSubPlan } from "./AutoSubPlanDialog";
import type { PitchPosition } from "./PositionBadge";

const makePlayer = (id: string, position: PitchPosition | null, x = 50, y = 50) => ({
  id,
  name: id,
  position: position ? { x, y } : null,
  currentPitchPosition: position || undefined,
  assignedPositions: position ? [position] : (["DEF", "MID", "FWD"] as PitchPosition[]),
});

const simulateTotals = (players: any[], plan: any[], halfSec: number) => {
  const onPitch = new Set<string>(players.filter((p) => p.position).map((p) => p.id));
  const totals = new Map<string, number>(players.map((p) => [p.id, 0]));
  const events = [...plan].sort(
    (a, b) => (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time)
  );
  let last = 0;
  const totalSec = halfSec * 2;
  for (const ev of events) {
    const t = ev.half === 1 ? ev.time : halfSec + ev.time;
    onPitch.forEach((id) => totals.set(id, totals.get(id)! + (t - last)));
    last = t;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
  }
  onPitch.forEach((id) => totals.set(id, totals.get(id)! + (totalSec - last)));
  return totals;
};

const countWindows = (plan: any[], halfSec: number) => {
  const set = new Set<number>();
  for (const ev of plan) set.add(ev.half === 1 ? ev.time : halfSec + ev.time);
  return set.size;
};

const buildRoster = (
  teamSize: number,
  benchCount: number,
  positions: PitchPosition[]
): any[] => {
  const players: any[] = [];
  // GK + N-1 outfielders. Distribute outfielders by positions list length.
  players.push(makePlayer("GK1", "GK"));
  let idx = 0;
  for (let i = 1; i < teamSize; i++) {
    const pos = positions[(i - 1) % positions.length];
    players.push(makePlayer(`P${i}`, pos, 30 + (i % 4) * 15, 20 + ((i * 7) % 60)));
  }
  // bench (one of which we mark as 2H GK candidate)
  for (let b = 0; b < benchCount; b++) {
    const id = b === 0 ? "GK2" : `B${b}`;
    players.push(makePlayer(id, null));
  }
  // ensure outfielders flexible
  players.forEach((p) => {
    if (p.currentPitchPosition && p.currentPitchPosition !== "GK") {
      p.assignedPositions = ["DEF", "MID", "FWD"] as PitchPosition[];
    }
  });
  return players;
};

interface Scenario {
  label: string;
  teamSize: 4 | 7 | 9 | 11;
  bench: number;
  halfMin: number;
  positions: PitchPosition[];
}

const scenarios: Scenario[] = [
  // 4-a-side (small-sided, short halves)
  { label: "4v4 +1 sub", teamSize: 4, bench: 1, halfMin: 12, positions: ["DEF", "MID", "FWD"] },
  { label: "4v4 +2 subs", teamSize: 4, bench: 2, halfMin: 12, positions: ["DEF", "MID", "FWD"] },
  { label: "4v4 +4 subs", teamSize: 4, bench: 4, halfMin: 12, positions: ["DEF", "MID", "FWD"] },

  // 7-a-side (junior typical)
  { label: "7v7 +1 sub", teamSize: 7, bench: 1, halfMin: 20, positions: ["DEF", "DEF", "MID", "MID", "FWD", "FWD"] },
  { label: "7v7 +2 subs", teamSize: 7, bench: 2, halfMin: 20, positions: ["DEF", "DEF", "MID", "MID", "FWD", "FWD"] },
  { label: "7v7 +4 subs (large bench)", teamSize: 7, bench: 4, halfMin: 20, positions: ["DEF", "DEF", "MID", "MID", "FWD", "FWD"] },
  { label: "7v7 +6 subs (very large)", teamSize: 7, bench: 6, halfMin: 20, positions: ["DEF", "DEF", "MID", "MID", "FWD", "FWD"] },

  // 9-a-side
  { label: "9v9 +1 sub", teamSize: 9, bench: 1, halfMin: 25, positions: ["DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD"] },
  { label: "9v9 +3 subs", teamSize: 9, bench: 3, halfMin: 25, positions: ["DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD"] },
  { label: "9v9 +5 subs", teamSize: 9, bench: 5, halfMin: 25, positions: ["DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD"] },

  // 11-a-side
  { label: "11v11 +2 subs", teamSize: 11, bench: 2, halfMin: 30, positions: ["DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"] },
  { label: "11v11 +4 subs", teamSize: 11, bench: 4, halfMin: 30, positions: ["DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"] },
  { label: "11v11 +6 subs", teamSize: 11, bench: 6, halfMin: 30, positions: ["DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"] },
];

interface Result {
  label: string;
  mode: "Standard" | "Frequent";
  windows: number;
  subs: number;
  spreadMin: number;
  outfieldSpreadMin: number;
  shortestShiftMin: number;
  longestShiftMin: number;
  benchTimeFairness: number;
  bouncesBackImmediately: number;
}

const analyse = (s: Scenario, mode: 1 | 2): Result => {
  const players = buildRoster(s.teamSize, s.bench, s.positions);
  const halfSec = s.halfMin * 60;
  // Pick GK2 as preferred 2H GK if it exists on bench
  const preferred2HGk = players.find((p) => p.id === "GK2") ? "GK2" : undefined;
  const plan = createSubPlan(
    players as any,
    s.teamSize,
    halfSec,
    mode,
    false,
    false,
    true,
    0,
    1,
    preferred2HGk,
    5
  );
  const totals = simulateTotals(players, plan, halfSec);
  const allMin = [...totals.values()].map((v) => v / 60);
  // outfield-only = exclude pure-GK players
  const gkIds = new Set(players.filter((p) => p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK").map((p) => p.id));
  const outfieldVals = [...totals.entries()].filter(([id]) => !gkIds.has(id)).map(([, s]) => s / 60);

  // Compute shortest shift duration per player (time between consecutive on/off events)
  const events = [...plan].sort((a, b) => (a.half === 1 ? a.time : halfSec + a.time) - (b.half === 1 ? b.time : halfSec + b.time));
  const shifts: number[] = [];
  const onSince = new Map<string, number>();
  players.filter((p) => p.position).forEach((p) => onSince.set(p.id, 0));
  for (const ev of events) {
    const t = ev.half === 1 ? ev.time : halfSec + ev.time;
    if (onSince.has(ev.playerOut.id)) {
      shifts.push(t - onSince.get(ev.playerOut.id)!);
      onSince.delete(ev.playerOut.id);
    }
    onSince.set(ev.playerIn.id, t);
  }
  // close out final shifts
  onSince.forEach((start) => shifts.push(halfSec * 2 - start));

  // Bounce-back: same player off then on within 90s, or on then off within 90s
  let bounces = 0;
  const recent = new Map<string, { kind: "on" | "off"; t: number }>();
  for (const ev of events) {
    const t = ev.half === 1 ? ev.time : halfSec + ev.time;
    const prevOut = recent.get(ev.playerOut.id);
    if (prevOut?.kind === "on" && t - prevOut.t < 90) bounces++;
    const prevIn = recent.get(ev.playerIn.id);
    if (prevIn?.kind === "off" && t - prevIn.t < 90) bounces++;
    recent.set(ev.playerOut.id, { kind: "off", t });
    recent.set(ev.playerIn.id, { kind: "on", t });
  }

  return {
    label: s.label,
    mode: mode === 1 ? "Standard" : "Frequent",
    windows: countWindows(plan, halfSec),
    subs: plan.length,
    spreadMin: +(Math.max(...allMin) - Math.min(...allMin)).toFixed(1),
    outfieldSpreadMin: +(Math.max(...outfieldVals) - Math.min(...outfieldVals)).toFixed(1),
    shortestShiftMin: +(Math.min(...shifts) / 60).toFixed(1),
    longestShiftMin: +(Math.max(...shifts) / 60).toFixed(1),
    benchTimeFairness: 0,
    bouncesBackImmediately: bounces,
  };
};

describe("AUDIT", () => {
  it("runs both modes across all team sizes", () => {
    const rows: Result[] = [];
    for (const s of scenarios) {
      for (const mode of [1, 2] as const) {
        try {
          rows.push(analyse(s, mode));
        } catch (e) {
          console.error(`FAILED ${s.label} mode=${mode}:`, (e as Error).message);
        }
      }
    }
    // print pretty table
    console.log("\n" + "=".repeat(120));
    console.log(
      ["Scenario".padEnd(28), "Mode".padEnd(10), "Win", "Subs", "Spread'", "OutSprd", "ShortSh'", "LongSh'", "Bounce"].join(" | ")
    );
    console.log("-".repeat(120));
    for (const r of rows) {
      console.log(
        [
          r.label.padEnd(28),
          r.mode.padEnd(10),
          String(r.windows).padStart(3),
          String(r.subs).padStart(4),
          String(r.spreadMin).padStart(7),
          String(r.outfieldSpreadMin).padStart(7),
          String(r.shortestShiftMin).padStart(8),
          String(r.longestShiftMin).padStart(7),
          String(r.bouncesBackImmediately).padStart(6),
        ].join(" | ")
      );
    }
    console.log("=".repeat(120));
    expect(rows.length).toBeGreaterThan(0);
  });
});
