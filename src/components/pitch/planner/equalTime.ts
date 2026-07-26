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
  name: string;
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
  // The rotation pool can only share the outfield capacity. Add goalkeeper
  // duty back only when that goalkeeper is also in the rotation pool (for
  // example, two outfield-capable players swapping GK at halftime). A locked
  // GK-only player is intentionally outside the pool, so counting their full
  // match here inflates every outfield target and distorts swap scoring.
  let rotationPoolGkSeconds = 0;
  if (gk1H && rotationIds.has(gk1H.id)) rotationPoolGkSeconds += halfDurationSec;
  if (gk2H && rotationIds.has(gk2H.id)) rotationPoolGkSeconds += halfDurationSec;
  const totalPlayerSeconds = outfieldSlots * totalSec + rotationPoolGkSeconds;
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

  // Exact cyclic solution for a universally compatible outfield pool.
  // Across N equal periods, rotating one player through a FIFO bench queue at
  // every boundary gives every player exactly `outfieldSlots` periods on the
  // field. It is both mathematically optimal and operationally compact: N-1
  // substitution events rather than a micro-sub every 30 seconds.
  const occupiedPositions = [...new Set(currentPosition.values())];
  const hasGkChange = !!(gk1H && gk2H && gk1H.id !== gk2H.id);
  const cyclicBoundaries = Array.from(
    { length: Math.max(0, rotationPool.length - 1) },
    (_, index) => Math.round((totalSec * (index + 1)) / rotationPool.length),
  );
  const boundariesRespectBlackouts = cyclicBoundaries.every((absolute) => {
    const intoHalf = absolute < halfDurationSec ? absolute : absolute - halfDurationSec;
    return intoHalf >= noSubBeforeSec && intoHalf < halfDurationSec - noSubAfterSec;
  });
  const approximatePeriodSec = totalSec / rotationPool.length;
  const benchCount = rotationPool.length - outfieldSlots;
  const shortestRepeatGapSec = approximatePeriodSec * Math.min(outfieldSlots, benchCount);
  const universallyCompatible =
    !hasGkChange &&
    initialOutfieldOnPitch.length === outfieldSlots &&
    rotationPool.length > outfieldSlots &&
    boundariesRespectBlackouts &&
    shortestRepeatGapSec >= minShiftSec &&
    rotationPool.every((player) =>
      occupiedPositions.every((position) => canPlay(player, position)),
    );

  if (universallyCompatible) {
    const onQueue = initialOutfieldOnPitch.map((player) => player.id);
    const benchQueue = rotationPool
      .filter((player) => !onPitchOutfield.has(player.id))
      .map((player) => player.id);
    let previousAbs = 0;

    for (let period = 1; period < rotationPool.length; period += 1) {
      const absolute = cyclicBoundaries[period - 1];
      const elapsed = absolute - previousAbs;
      onQueue.forEach((id) => projected.set(id, (projected.get(id) ?? 0) + elapsed));

      const outId = onQueue.shift();
      const inId = benchQueue.shift();
      if (!outId || !inId) break;
      const out = playerById.get(outId);
      const incoming = playerById.get(inId);
      const outPos = currentPosition.get(outId);
      if (!out || !incoming || !outPos) break;

      plan.push({
        time: absolute < halfDurationSec ? absolute : absolute - halfDurationSec,
        half: absolute < halfDurationSec ? 1 : 2,
        playerOut: out,
        playerIn: incoming,
        executed: false,
      });

      currentPosition.delete(outId);
      currentPosition.set(inId, outPos);
      onPitchOutfield.delete(outId);
      onPitchOutfield.add(inId);
      onQueue.push(inId);
      benchQueue.push(outId);
      previousAbs = absolute;
    }

    const tail = totalSec - previousAbs;
    onQueue.forEach((id) => projected.set(id, (projected.get(id) ?? 0) + tail));
    const values = rotationPool.map((player) => projected.get(player.id) ?? 0);
    const deviations = rotationPool.map((player) =>
      Math.abs((projected.get(player.id) ?? 0) - (targetSec.get(player.id) ?? 0)),
    );
    const remainder = totalPlayerSeconds % rotationPool.length;
    return {
      plan,
      projectedSec: projected,
      targetSec,
      spreadSec: Math.max(...values) - Math.min(...values),
      maxDeviationSec: Math.max(...deviations),
      perfectFloorSec: remainder === 0 ? 0 : 1,
    };
  }

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
  //
  // Scoring strategy (squad-wide fairness):
  //   Primary   — sum of squared end-of-match deviations (projects each
  //               player forward assuming the current on-pitch set remains
  //               unchanged for the remaining time). Prefers reductions in
  //               total squared error across the WHOLE rotation pool, not
  //               just the single worst player.
  //   Secondary — maximum absolute projected deviation.
  //   Tertiary  — stable id ordering (outId then inId) for determinism.
  //
  // Accepting swaps that improve total squared deviation — even when the
  // maximum absolute deviation is temporarily unchanged — is what breaks the
  // multi-substitute stalemate: bringing on an under-played bench player can
  // reduce the sum-of-squares even if a second, equally-underplayed player
  // remains on the bench and keeps the maximum deviation the same.
  const findBestSwap = (
    absT: number,
    half: 1 | 2,
  ): {
    out: EqualTimePlayer;
    in: EqualTimePlayer;
    outPos: PitchPosition;
    swap?: { player: EqualTimePlayer; fromPosition: PitchPosition; toPosition: PitchPosition };
    /** Reduction in sum-of-squared-deviations achieved (positive = improvement). */
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

    const remaining = totalSec - absT;
    if (remaining <= 0) return null;

    // Deterministic ordering. Primary key = deviation, secondary = id (string
    // compare) so ties resolve identically across runs.
    benchEligible.sort((a, b) => dev(a) - dev(b) || (a < b ? -1 : a > b ? 1 : 0));
    onPitchEligible.sort((a, b) => dev(b) - dev(a) || (a < b ? -1 : a > b ? 1 : 0));

    // Baseline score: sum of squared projected deviations if we do NOTHING
    // this chunk. Bench players stay bench (accumulate 0 more); on-pitch
    // players collect `remaining` more seconds.
    let baseSumSq = 0;
    let baseMaxAbs = 0;
    rotationPool.forEach((p) => {
      const cur = projected.get(p.id) ?? 0;
      const tgt = targetSec.get(p.id) ?? 0;
      const proj = cur + (onPitchOutfield.has(p.id) ? remaining : 0);
      const d = proj - tgt;
      baseSumSq += d * d;
      const ad = Math.abs(d);
      if (ad > baseMaxAbs) baseMaxAbs = ad;
    });

    let best:
      | {
          out: EqualTimePlayer;
          in: EqualTimePlayer;
          outPos: PitchPosition;
          swap?: {
            player: EqualTimePlayer;
            fromPosition: PitchPosition;
            toPosition: PitchPosition;
          };
          improvement: number;
          newSumSq: number;
          newMaxAbs: number;
          outId: string;
          inId: string;
        }
      | null = null;

    for (const inId of benchEligible) {
      const inP = playerById.get(inId)!;
      for (const outId of onPitchEligible) {
        if (inId === outId) continue;
        // Min-shift gate on the player coming OFF.
        const lastOut = lastSubAt.get(outId);
        if (lastOut !== undefined && absT - lastOut < minShiftSec) continue;
        // Min-shift gate on the player coming ON.
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

        // Score the hypothetical post-swap squad projection.
        let newSumSq = 0;
        let newMaxAbs = 0;
        rotationPool.forEach((p) => {
          const cur = projected.get(p.id) ?? 0;
          const tgt = targetSec.get(p.id) ?? 0;
          const onAfter =
            p.id === outId
              ? false
              : p.id === inId
                ? true
                : onPitchOutfield.has(p.id);
          const proj = cur + (onAfter ? remaining : 0);
          const d = proj - tgt;
          newSumSq += d * d;
          const ad = Math.abs(d);
          if (ad > newMaxAbs) newMaxAbs = ad;
        });

        // Strict improvement in squad-wide fairness (sum-of-squares) required.
        // Note: max deviation is allowed to stay unchanged — this is the fix
        // for the multi-sub stalemate.
        if (newSumSq >= baseSumSq) continue;

        const improvement = baseSumSq - newSumSq;
        if (!best) {
          best = {
            out: outP,
            in: inP,
            outPos,
            swap: swapMeta,
            improvement,
            newSumSq,
            newMaxAbs,
            outId,
            inId,
          };
          continue;
        }
        // Tie-break chain: lower newSumSq → lower newMaxAbs → stable ids.
        if (
          newSumSq < best.newSumSq ||
          (newSumSq === best.newSumSq && newMaxAbs < best.newMaxAbs) ||
          (newSumSq === best.newSumSq &&
            newMaxAbs === best.newMaxAbs &&
            (outId < best.outId || (outId === best.outId && inId < best.inId)))
        ) {
          best = {
            out: outP,
            in: inP,
            outPos,
            swap: swapMeta,
            improvement,
            newSumSq,
            newMaxAbs,
            outId,
            inId,
          };
        }
      }
    }

    if (!best) return null;
    return {
      out: best.out,
      in: best.in,
      outPos: best.outPos,
      swap: best.swap,
      improvement: best.improvement,
    };
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
