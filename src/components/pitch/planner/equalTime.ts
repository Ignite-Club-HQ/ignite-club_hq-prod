/**
 * Equal-time deterministic planner.
 *
 * Built to satisfy the spec:
 *  1. Target minutes computed up-front for every player.
 *  2. Globally optimises toward those targets (deficit-driven greedy).
 *  3. Minute deviation is the primary objective (continuity is broken if it
 *     reduces deviation).
 *  4. Bench time spreads evenly across the full game.
 *  5. Naturally converges to evenly-spaced rotations in 1-bench scenarios.
 *  6. GK halftime swap is honoured without dragging the rest of the squad
 *     off-target.
 *  7. Starter status is intentionally ignored — every player is treated as a
 *     pure rotation candidate.
 *
 * The algorithm walks the match in fine time-slices (default 30 s). At each
 * slice boundary it considers a single substitution that pulls the most
 * over-played player off and brings the most under-played player on, subject
 * to position eligibility and a configurable minimum shift length.
 *
 * The output is a SubstitutionEvent[] compatible with the existing planner
 * (same fields, same `time` / `half` semantics). The HT GK swap, when
 * present, is emitted as a sub event with `time: 0, half: 2` exactly as the
 * existing planner does — the rest of the system treats it identically.
 */

import type { PitchPosition } from "../PositionBadge";

export interface EqualTimePlayer {
  id: string;
  name?: string;
  /** Currently on pitch in some position (any) — null = bench. */
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  /** Restricted set of allowed positions. Empty / undefined = anywhere. */
  assignedPositions?: PitchPosition[];
  /** Seconds already played before this plan starts. */
  minutesPlayed?: number;
  isInjured?: boolean;
}

export interface EqualTimeSubEvent {
  time: number;
  half: 1 | 2;
  playerOut: EqualTimePlayer;
  playerIn: EqualTimePlayer;
  positionSwap?: {
    player: EqualTimePlayer;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

export interface EqualTimePlanInput {
  players: EqualTimePlayer[];
  teamSize: number;
  halfDurationSec: number;
  /** First-half GK (locked into goal for half 1). */
  gk1H?: EqualTimePlayer;
  /** Second-half GK (locked into goal for half 2). May === gk1H (no swap). */
  gk2H?: EqualTimePlayer;
  /** Slice resolution. 30 s strikes a good balance of fairness vs tractability. */
  chunkSec?: number;
  /** Minimum on-pitch shift length before a player can be pulled (sec). */
  minShiftSec?: number;
  /** No subs in the first N seconds of each half. */
  noSubBeforeSec?: number;
  /** No subs in the trailing N seconds of each half. */
  noSubAfterSec?: number;
}

export interface EqualTimePlanResult {
  plan: EqualTimeSubEvent[];
  /** Projected total seconds per player at end of match. */
  projectedSec: Map<string, number>;
  /** Per-player target seconds (incl. GK time when applicable). */
  targetSec: Map<string, number>;
  /** max - min of deviation from target (seconds). */
  spreadSec: number;
  /** Largest single |actual - target| (seconds). */
  maxDeviationSec: number;
  /**
   * Mathematical fairness floor (the smallest spread possible, ignoring
   * cadence + position constraints). 0 when (slots × T) is divisible by N.
   */
  perfectFloorSec: number;
}

const DEFAULT_CHUNK = 30;

// True iff the player can stand in this position.
const canPlay = (p: EqualTimePlayer, pos: PitchPosition | undefined): boolean => {
  if (!pos) return true;
  if (!p.assignedPositions?.length) return true;
  return p.assignedPositions.includes(pos);
};

const isGkOnly = (p: EqualTimePlayer): boolean =>
  p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK";

export function buildEqualTimePlan(input: EqualTimePlanInput): EqualTimePlanResult {
  const {
    players,
    teamSize,
    halfDurationSec,
    gk1H,
    gk2H,
    chunkSec = DEFAULT_CHUNK,
    minShiftSec = 120,
    noSubBeforeSec = 0,
    noSubAfterSec = 30,
  } = input;

  const totalSec = halfDurationSec * 2;
  const outfieldSlots = Math.max(0, teamSize - (gk1H ? 1 : 0));

  // Rotation pool = every healthy non-GK-only player. Includes gk1H/gk2H when
  // they're available outfield in the *other* half (which is always true when
  // they aren't GK-only).
  const rotationPool = players.filter((p) => !p.isInjured && !isGkOnly(p));
  const rotationIds = new Set(rotationPool.map((p) => p.id));
  if (rotationPool.length === 0 || outfieldSlots <= 0) {
    return {
      plan: [],
      projectedSec: new Map(),
      targetSec: new Map(),
      spreadSec: 0,
      maxDeviationSec: 0,
      perfectFloorSec: 0,
    };
  }

  // Per-player TOTAL target (GK seconds + outfield seconds). Equal-time means
  // every rotation player gets the same total. GK-locked-only players are
  // outside the pool entirely.
  const totalPlayerSeconds = teamSize * totalSec;
  const perPlayerTarget = totalPlayerSeconds / rotationPool.length;
  const targetSec = new Map<string, number>();
  rotationPool.forEach((p) => targetSec.set(p.id, perPlayerTarget));

  // Per-half outfield-eligible pool. Excludes the half's GK (they're locked
  // into goal — they can't ALSO play outfield in that half).
  const eligibleH1 = new Set(
    rotationPool.filter((p) => !gk1H || p.id !== gk1H.id).map((p) => p.id),
  );
  const eligibleH2 = new Set(
    rotationPool.filter((p) => !gk2H || p.id !== gk2H.id).map((p) => p.id),
  );

  // Initial outfield on-pitch. Players currently on the pitch in non-GK
  // positions form the starting outfield set. We honour up to `outfieldSlots`.
  const initialOutfieldOnPitch = players.filter(
    (p) => p.position !== null && p.currentPitchPosition !== "GK",
  );

  // Position bookkeeping: who currently stands where.
  const currentPosition = new Map<string, PitchPosition>();
  initialOutfieldOnPitch.forEach((p) => {
    const pos = (p.currentPitchPosition ??
      p.assignedPositions?.find((q) => q !== "GK") ??
      "MID") as PitchPosition;
    currentPosition.set(p.id, pos);
  });

  // Projected seconds — seeded from minutesPlayed (treated as seconds).
  const projected = new Map<string, number>();
  rotationPool.forEach((p) => projected.set(p.id, p.minutesPlayed ?? 0));
  // GK time is credited up-front (the GKs are guaranteed those seconds).
  if (gk1H) projected.set(gk1H.id, (projected.get(gk1H.id) ?? 0) + halfDurationSec);
  if (gk2H && (!gk1H || gk2H.id !== gk1H.id)) {
    projected.set(gk2H.id, (projected.get(gk2H.id) ?? 0) + halfDurationSec);
  }

  // playerById for quick lookups when constructing sub events.
  const playerById = new Map<string, EqualTimePlayer>(players.map((p) => [p.id, p]));

  const plan: EqualTimeSubEvent[] = [];
  const lastSubAt = new Map<string, number>(); // absolute seconds — last time involved in a swap
  const onPitchOutfield = new Set<string>(initialOutfieldOnPitch.map((p) => p.id));

  // If there's an HT GK swap, emit it now (pure GK change — no outfield
  // positions involved). The downstream simulator treats this as such.
  if (gk1H && gk2H && gk1H.id !== gk2H.id) {
    plan.push({
      time: 0,
      half: 2,
      playerOut: gk1H,
      playerIn: gk2H,
      executed: false,
    });
  }

  // ------------------------------------------------------------
  // Slice walk.
  // ------------------------------------------------------------
  // We walk the match in `chunkSec` increments. Each step:
  //   1. Determine the current half + eligible pool.
  //   2. At HT crossing: if there's a GK swap, swap gk2H out of the outfield
  //      set (they're now in goal) and add gk1H to the outfield set if they
  //      can take an outfield slot.
  //   3. If the chunk boundary is sub-eligible, evaluate the best 1-swap
  //      that reduces max deviation, subject to position + min-shift.
  //   4. Credit chunk seconds to the post-swap on-pitch outfielders.
  let prevHalf: 1 | 2 = 1;

  const halfOf = (absT: number): 1 | 2 => (absT < halfDurationSec ? 1 : 2);
  const intoHalfSec = (absT: number, half: 1 | 2) =>
    half === 1 ? absT : absT - halfDurationSec;

  // Helper — pick best 1-swap at time `absT` in `half`. Returns null if
  // nothing improves OR if no legal swap exists.
  const findBestSwap = (
    absT: number,
    half: 1 | 2,
  ): {
    out: EqualTimePlayer;
    in: EqualTimePlayer;
    outPos: PitchPosition;
    swap?: { player: EqualTimePlayer; fromPosition: PitchPosition; toPosition: PitchPosition };
    /** Reduction in max(|deviation|) achieved (positive = improvement). */
    improvement: number;
  } | null => {
    const eligible = half === 1 ? eligibleH1 : eligibleH2;

    // Snapshot current deviations.
    const dev = (id: string) => (projected.get(id) ?? 0) - (targetSec.get(id) ?? 0);
    const benchEligible: string[] = [];
    rotationPool.forEach((p) => {
      if (!eligible.has(p.id)) return;
      if (onPitchOutfield.has(p.id)) return;
      benchEligible.push(p.id);
    });
    const onPitchEligible = Array.from(onPitchOutfield);

    if (benchEligible.length === 0 || onPitchEligible.length === 0) return null;

    // Order: bring on the most under-played, take off the most over-played.
    benchEligible.sort((a, b) => dev(a) - dev(b)); // ascending
    onPitchEligible.sort((a, b) => dev(b) - dev(a)); // descending

    let best: ReturnType<typeof findBestSwap> = null;

    for (const inId of benchEligible) {
      const inP = playerById.get(inId)!;
      for (const outId of onPitchEligible) {
        if (inId === outId) continue;
        // Min-shift gate on the player coming OFF.
        const lastOut = lastSubAt.get(outId);
        if (lastOut !== undefined && absT - lastOut < minShiftSec) continue;
        // Min-shift gate on the player coming ON (don't bounce them right back
        // unless a strict improvement requires it).
        const lastIn = lastSubAt.get(inId);
        if (lastIn !== undefined && absT - lastIn < minShiftSec) continue;

        const outP = playerById.get(outId)!;
        const outPos = currentPosition.get(outId);
        if (!outPos) continue;

        // Direct swap?
        let swapMeta:
          | { player: EqualTimePlayer; fromPosition: PitchPosition; toPosition: PitchPosition }
          | undefined;

        if (!canPlay(inP, outPos)) {
          // Try a 3rd-player swap.
          let foundSwap = false;
          for (const qId of onPitchEligible) {
            if (qId === outId || qId === inId) continue;
            const qPos = currentPosition.get(qId);
            const qP = playerById.get(qId);
            if (!qPos || !qP) continue;
            if (!canPlay(inP, qPos)) continue;
            if (!canPlay(qP, outPos)) continue;
            swapMeta = { player: qP, fromPosition: qPos, toPosition: outPos };
            foundSwap = true;
            break;
          }
          if (!foundSwap) continue;
        }

        // Compute hypothetical post-swap max deviation. The swap doesn't
        // immediately change deviations — it changes who accrues seconds for
        // the REMAINING time. Approximate: project the remaining time to the
        // end of game evenly across the new on-pitch set, and take the new
        // max deviation. This is a one-step lookahead; good enough for a
        // greedy hill climb.
        const remaining = totalSec - absT;
        if (remaining <= 0) continue;

        // Build a "new on-pitch outfield" snapshot.
        const newOn = new Set(onPitchOutfield);
        newOn.delete(outId);
        newOn.add(inId);

        // For each player, project their final seconds:
        //   - If they're in `newOn`, they accumulate `remaining` × (avg coverage).
        //     Use the simplification: each on-pitch player gets `remaining` sec.
        //   - If they're on bench (and eligible this half), they accumulate 0
        //     for now but might come on later. Use 0 (worst case for them).
        // The single-step heuristic is conservative; the iterative loop will
        // re-evaluate every chunk so final deviations converge.
        let maxAbsDev = 0;
        let maxAbsDevCurrent = 0;
        rotationPool.forEach((p) => {
          const cur = projected.get(p.id) ?? 0;
          const tgt = targetSec.get(p.id) ?? 0;
          const onIn = newOn.has(p.id);
          const proj = cur + (onIn ? remaining : 0);
          const d = Math.abs(proj - tgt);
          if (d > maxAbsDev) maxAbsDev = d;
          const projCur = cur + (onPitchOutfield.has(p.id) ? remaining : 0);
          const dCur = Math.abs(projCur - tgt);
          if (dCur > maxAbsDevCurrent) maxAbsDevCurrent = dCur;
        });

        const improvement = maxAbsDevCurrent - maxAbsDev;
        if (improvement <= 0) continue;
        if (!best || improvement > best.improvement) {
          best = { out: outP, in: inP, outPos, swap: swapMeta, improvement };
        }
      }
      if (best && best.improvement > minShiftSec) break; // good enough
    }

    return best;
  };

  for (let absT = 0; absT < totalSec; absT += chunkSec) {
    const curHalf = halfOf(absT);

    // HT crossing: apply GK swap to outfield bookkeeping.
    if (curHalf === 2 && prevHalf === 1) {
      if (gk1H && gk2H && gk1H.id !== gk2H.id) {
        // gk2H was on bench (locked-out outfield in H1). Now in goal — remove
        // from outfield set just in case some upstream snapshot added them.
        onPitchOutfield.delete(gk2H.id);
        currentPosition.delete(gk2H.id);
        // gk1H is now available as outfield — slot them onto the pitch IF
        // an outfield slot is open AND they aren't already there.
        if (!onPitchOutfield.has(gk1H.id) && onPitchOutfield.size < outfieldSlots) {
          // Pick a position they can play.
          const pos =
            (gk1H.assignedPositions?.find((q) => q !== "GK") ??
              "MID") as PitchPosition;
          onPitchOutfield.add(gk1H.id);
          currentPosition.set(gk1H.id, pos);
        }
      }
      prevHalf = 2;
    }

    // No-sub blackout windows.
    const intoHalf = intoHalfSec(absT, curHalf);
    const halfRemaining = halfDurationSec - intoHalf;
    const subEligible =
      intoHalf >= noSubBeforeSec &&
      halfRemaining > noSubAfterSec &&
      absT > 0; // never sub at t=0

    if (subEligible) {
      const swap = findBestSwap(absT, curHalf);
      if (swap) {
        // Emit the sub event.
        const time = intoHalfSec(absT, curHalf);
        plan.push({
          time,
          half: curHalf,
          playerOut: swap.out,
          playerIn: swap.in,
          executed: false,
          positionSwap: swap.swap,
        });
        // Apply position bookkeeping.
        onPitchOutfield.delete(swap.out.id);
        onPitchOutfield.add(swap.in.id);
        if (swap.swap) {
          // The swapped 3rd player moves into outPos; incoming takes 3rd's pos.
          currentPosition.set(swap.swap.player.id, swap.swap.toPosition);
          currentPosition.set(swap.in.id, swap.swap.fromPosition);
          currentPosition.delete(swap.out.id);
        } else {
          currentPosition.set(swap.in.id, swap.outPos);
          currentPosition.delete(swap.out.id);
        }
        lastSubAt.set(swap.out.id, absT);
        lastSubAt.set(swap.in.id, absT);
      }
    }

    // Credit this chunk to whoever is currently on the outfield.
    const credit = Math.min(chunkSec, totalSec - absT);
    onPitchOutfield.forEach((id) => {
      projected.set(id, (projected.get(id) ?? 0) + credit);
    });
  }

  // Compute spread + max deviation across rotation pool.
  let minP = Infinity;
  let maxP = -Infinity;
  let maxDev = 0;
  rotationPool.forEach((p) => {
    const v = projected.get(p.id) ?? 0;
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
    const d = Math.abs(v - (targetSec.get(p.id) ?? 0));
    if (d > maxDev) maxDev = d;
  });

  // Mathematical floor: when (slots × T) is exactly divisible by N, perfect
  // equality is possible (spread = 0). Otherwise it's the residue from
  // integer-second rounding.
  const remainder = totalPlayerSeconds % rotationPool.length;
  const perfectFloorSec = remainder === 0 ? 0 : 1; // chunk-level resolution; near-zero

  return {
    plan,
    projectedSec: projected,
    targetSec,
    spreadSec: maxP - minP,
    maxDeviationSec: maxDev,
    perfectFloorSec,
  };
}

/**
 * Compute the mathematically-perfect target seconds per player given a
 * squad / slots / match length. Lives here so callers can show the floor in
 * fairness diagnostics without re-deriving it.
 */
export function equalTimeTargetSec(
  rotationPlayerCount: number,
  teamSize: number,
  totalMatchSec: number,
): number {
  if (rotationPlayerCount <= 0) return 0;
  return (teamSize * totalMatchSec) / rotationPlayerCount;
}
