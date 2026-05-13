// ===========================================================================
// fairnessRebalance — Phase-2 fairness-first post-processor.
//
// Runs after the existing window-construction planner and tries to tighten
// the spread between most- and least-played outfielders by locally swapping
// who comes ON or OFF at each existing window. It does NOT move windows or
// change the GK halftime swap. It only re-assigns OUT/IN players when a swap
// produces a fairer outcome and stays valid (no double-on, no impossible
// off, minShift respected, position playable).
//
// Public API: rebalanceForFairness(plan, players, opts) -> SubstitutionEvent[]
// ===========================================================================
import type { PitchPosition } from "../PositionBadge";

interface PlannerPlayer {
  id: string;
  name: string;
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  assignedPositions?: PitchPosition[];
  minutesPlayed?: number;
}

interface PlannerEvent {
  time: number;
  half: 1 | 2;
  playerOut: PlannerPlayer;
  playerIn: PlannerPlayer;
  positionSwap?: {
    player: PlannerPlayer;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

interface RebalanceOpts {
  halfDurationSeconds: number;
  startElapsedSeconds: number;
  startHalf: 1 | 2;
  /** Minimum on-pitch shift before a player may be pulled (seconds). */
  minShiftSeconds: number;
  /** GK halftime in (if any) — protected: never swapped by the rebalancer. */
  halftimeGkInId?: string;
  /** Starting GK id — protected. */
  startingGkId?: string;
  /** Hard ceiling on iterations to keep this O(n²) loop bounded. */
  maxIterations?: number;
}

interface SimResult {
  totals: Map<string, number>;
  spread: number;
  /** abs-time when each player was last brought on. -1 if never on. */
  shiftStartAbs: Map<string, number>;
  /** ordered absolute times per event (matches input order index). */
  eventAbs: number[];
}

const absOf = (e: PlannerEvent, halfDur: number) =>
  e.half === 1 ? e.time : halfDur + e.time;

const sortedEventOrder = (events: PlannerEvent[], halfDur: number): number[] => {
  const idx = events.map((_, i) => i);
  idx.sort((a, b) => {
    const ta = absOf(events[a], halfDur);
    const tb = absOf(events[b], halfDur);
    if (ta !== tb) return ta - tb;
    return a - b;
  });
  return idx;
};

/**
 * Walk the plan from kick-off to full-time, accumulating playing seconds per
 * player. Returns null if the plan is structurally invalid (player subbed on
 * while already on, or off while not on).
 */
function simulate(
  events: PlannerEvent[],
  startingOnPitchIds: Set<string>,
  players: PlannerPlayer[],
  opts: RebalanceOpts,
): SimResult | null {
  const halfDur = opts.halfDurationSeconds;
  const endAbs = halfDur * 2;
  const startAbs = opts.startHalf === 1
    ? Math.min(opts.startElapsedSeconds, halfDur)
    : halfDur + Math.min(opts.startElapsedSeconds, halfDur);

  const totals = new Map<string, number>();
  const shiftStartAbs = new Map<string, number>();
  players.forEach(p => {
    // Seed with already-played seconds (mid-game starts).
    totals.set(p.id, p.minutesPlayed ?? 0);
    shiftStartAbs.set(p.id, -1);
  });

  const onPitch = new Set<string>(startingOnPitchIds);
  onPitch.forEach(id => shiftStartAbs.set(id, startAbs));

  const order = sortedEventOrder(events, halfDur);
  const eventAbs: number[] = events.map(e => absOf(e, halfDur));

  let lastT = startAbs;
  for (const i of order) {
    const ev = events[i];
    if (ev.skipped) continue;
    const t = eventAbs[i];
    if (t < lastT) return null; // out-of-order timeline shouldn't happen
    onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (t - lastT)));
    lastT = t;
    if (!onPitch.has(ev.playerOut.id)) return null;
    if (onPitch.has(ev.playerIn.id)) return null;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
    shiftStartAbs.set(ev.playerIn.id, t);
  }
  onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (endAbs - lastT)));

  // Spread is computed across OUTFIELD players that are part of the rotation
  // pool — exclude full-game GK (someone whose only position is GK) so their
  // 40-min keeper credit doesn't dominate the spread metric.
  const rotationIds = new Set<string>();
  players.forEach(p => {
    const positions = p.assignedPositions ?? [];
    const fullGameGk = positions.length === 1 && positions[0] === "GK";
    if (fullGameGk) return;
    rotationIds.add(p.id);
  });
  const rotationTotals = [...rotationIds].map(id => totals.get(id) ?? 0);
  const spread = rotationTotals.length > 0
    ? Math.max(...rotationTotals) - Math.min(...rotationTotals)
    : 0;

  return { totals, spread, shiftStartAbs, eventAbs };
}

const playerCanCover = (player: PlannerPlayer, position: PitchPosition): boolean => {
  if (position === "GK") return false; // GK swaps handled separately
  const positions = player.assignedPositions ?? [];
  if (positions.length === 0) return true; // unconstrained
  return positions.includes(position);
};

/**
 * Try a single candidate swap on a cloned plan. Returns the resulting spread
 * if the swap is valid, otherwise null.
 */
function trySwap(
  events: PlannerEvent[],
  eventIndex: number,
  field: "playerOut" | "playerIn",
  newPlayer: PlannerPlayer,
  startingOnPitchIds: Set<string>,
  players: PlannerPlayer[],
  opts: RebalanceOpts,
): { spread: number; events: PlannerEvent[] } | null {
  const cloned = events.map(e => ({ ...e }));
  cloned[eventIndex] = { ...cloned[eventIndex], [field]: newPlayer };

  // For OUT swaps: also rewrite any later event that subbed `originalOut`
  // back ON or referenced them. Simplest valid policy: only allow OUT swaps
  // where the original OUT player has no later in-events between this and
  // their next bench transition — checked by simulation rejection.
  const sim = simulate(cloned, startingOnPitchIds, players, opts);
  if (!sim) return null;

  // Enforce minShift on the OUT side at this event.
  const ev = cloned[eventIndex];
  const evAbs = absOf(ev, opts.halfDurationSeconds);
  const origOutShift = sim.shiftStartAbs.get(ev.playerOut.id);
  // shiftStartAbs in the SimResult reflects post-event state; we need the
  // shift duration at the moment of the swap. Re-derive from the simulation
  // by replaying up to (but not including) this event.
  if (!checkMinShiftRespected(cloned, opts, startingOnPitchIds, players)) return null;

  return { spread: sim.spread, events: cloned };
}

/**
 * Independent minShift check: walks the plan in time order and rejects any
 * OUT event whose player has been on for less than minShiftSeconds.
 */
function checkMinShiftRespected(
  events: PlannerEvent[],
  opts: RebalanceOpts,
  startingOnPitchIds: Set<string>,
  players: PlannerPlayer[],
): boolean {
  const halfDur = opts.halfDurationSeconds;
  const startAbs = opts.startHalf === 1
    ? Math.min(opts.startElapsedSeconds, halfDur)
    : halfDur + Math.min(opts.startElapsedSeconds, halfDur);
  const shiftStart = new Map<string, number>();
  startingOnPitchIds.forEach(id => shiftStart.set(id, startAbs));
  const order = sortedEventOrder(events, halfDur);
  const minShift = opts.minShiftSeconds;
  // Protected players: GK rotation events are exempt.
  const isProtected = (id: string) =>
    id === opts.startingGkId || id === opts.halftimeGkInId;
  for (const i of order) {
    const ev = events[i];
    if (ev.skipped) continue;
    const absT = absOf(ev, halfDur);
    const startedAt = shiftStart.get(ev.playerOut.id);
    if (startedAt === undefined) return false; // off-the-bench event without a known on-time
    if (!isProtected(ev.playerOut.id) && absT - startedAt < minShift) return false;
    shiftStart.delete(ev.playerOut.id);
    shiftStart.set(ev.playerIn.id, absT);
  }
  return true;
}

/**
 * Main entry point. Iteratively performs local swaps to reduce the spread.
 * Conservative: only accepts swaps that strictly improve the spread by
 * at least 1 second. Caps iterations to keep cost bounded.
 */
export function rebalanceForFairness(
  plan: PlannerEvent[],
  players: PlannerPlayer[],
  opts: RebalanceOpts,
): PlannerEvent[] {
  if (plan.length === 0) return plan;
  const maxIterations = opts.maxIterations ?? 30;

  const startingOnPitchIds = new Set<string>(
    players.filter(p => p.position !== null).map(p => p.id),
  );

  const baseline = simulate(plan, startingOnPitchIds, players, opts);
  if (!baseline) return plan; // give up if input plan isn't simulable
  let best = plan.map(e => ({ ...e }));
  let bestSpread = baseline.spread;

  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;
    let bestStep: { idx: number; field: "playerOut" | "playerIn"; player: PlannerPlayer; spread: number } | null = null;

    for (let i = 0; i < best.length; i++) {
      const ev = best[i];
      if (ev.executed || ev.skipped) continue;
      // Skip GK halftime swap events — they are protected.
      const isGkRotation =
        (opts.startingGkId && ev.playerOut.id === opts.startingGkId) ||
        (opts.halftimeGkInId && ev.playerIn.id === opts.halftimeGkInId);
      if (isGkRotation) continue;

      const outPos = ev.playerOut.currentPitchPosition;
      if (!outPos || outPos === "GK") continue;

      // Candidates for IN: any player who isn't currently on at the moment of
      // the event, can play `outPos`, isn't already in this event, and isn't a
      // protected GK.
      for (const cand of players) {
        if (cand.id === ev.playerIn.id) continue;
        if (cand.id === opts.startingGkId || cand.id === opts.halftimeGkInId) continue;
        if (!playerCanCover(cand, outPos)) continue;
        const result = trySwap(best, i, "playerIn", cand, startingOnPitchIds, players, opts);
        if (!result) continue;
        if (result.spread < bestSpread - 1) {
          if (!bestStep || result.spread < bestStep.spread) {
            bestStep = { idx: i, field: "playerIn", player: cand, spread: result.spread };
          }
        }
      }

      // Candidates for OUT: any other player currently on the pitch at this
      // event's time who could be subbed off instead. Simulation will reject
      // any timeline-breaking pick.
      for (const cand of players) {
        if (cand.id === ev.playerOut.id) continue;
        if (cand.id === opts.startingGkId || cand.id === opts.halftimeGkInId) continue;
        if (!cand.currentPitchPosition || cand.currentPitchPosition === "GK") continue;
        // Position match: incoming player should be able to take cand's slot.
        if (!playerCanCover(ev.playerIn, cand.currentPitchPosition)) continue;
        const result = trySwap(best, i, "playerOut", cand, startingOnPitchIds, players, opts);
        if (!result) continue;
        if (result.spread < bestSpread - 1) {
          if (!bestStep || result.spread < bestStep.spread) {
            bestStep = { idx: i, field: "playerOut", player: cand, spread: result.spread };
          }
        }
      }
    }

    if (!bestStep) break;
    best = best.map((e, idx) => idx === bestStep!.idx ? { ...e, [bestStep!.field]: bestStep!.player } : e);
    bestSpread = bestStep.spread;
    improved = true;
    if (!improved) break;
  }

  return best;
}
