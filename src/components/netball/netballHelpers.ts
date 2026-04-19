/**
 * Helpers for the netball game board.
 * Pure functions only — no React, no side effects.
 */
import {
  NetballPlayer,
  NetballPosition,
  NetballSubEvent,
  POSITION_ALLOWED_ZONES,
  Quarter,
  QuarterLineup,
  NETBALL_POSITIONS,
} from "./types";
import { visiblePeriods, type PeriodType } from "@/lib/periodTypes";

export const getSubKey = (sub: NetballSubEvent): string =>
  `${sub.quarter}-${sub.time}-${sub.playerOut.id}-${sub.position}`;

/**
 * Validate whether a player can occupy a position.
 * In netball, positions are fixed — if a player is allowed to play GS they may
 * stand anywhere a GS may go. We treat the position itself as the validation
 * unit (since each slot is hard-coded).
 *
 * Coach-set preferred positions act as the "this player can play here" list.
 * If a player has no preferredPositions, they're considered eligible for all.
 */
export const isPositionAllowedForPlayer = (
  player: NetballPlayer,
  position: NetballPosition
): boolean => {
  if (!player.preferredPositions || player.preferredPositions.length === 0) return true;
  return player.preferredPositions.includes(position);
};

/**
 * Strength of the swap fit between an outgoing player's position and an
 * incoming player. Used to grade sub suggestions and to back the "warn" mode
 * when no preferredPositions are set.
 *   - "exact"      → incoming has the position in preferredPositions
 *   - "zone"       → incoming's preferred positions share a court zone
 *   - "any"        → no preferred positions known
 *   - "violation"  → preferred positions exist but none overlap zones
 */
export type SwapFit = "exact" | "zone" | "any" | "violation";

export const classifySwapFit = (
  incoming: NetballPlayer,
  position: NetballPosition
): SwapFit => {
  const prefs = incoming.preferredPositions ?? [];
  if (prefs.length === 0) return "any";
  if (prefs.includes(position)) return "exact";
  const targetZones = new Set(POSITION_ALLOWED_ZONES[position]);
  const zoneOverlap = prefs.some((pp) =>
    POSITION_ALLOWED_ZONES[pp].some((z) => targetZones.has(z))
  );
  return zoneOverlap ? "zone" : "violation";
};

/**
 * Find the closest valid like-for-like swap candidate from the bench
 * for a player coming off a given position.
 * Preference order:
 *   1. Bench player whose preferredPositions includes the target position
 *   2. Bench player with overlapping allowed zones
 *   3. Any non-injured bench player
 */
export const pickLikeForLikeBenchPlayer = (
  position: NetballPosition,
  bench: NetballPlayer[],
  excludeIds: string[] = []
): NetballPlayer | undefined => {
  const eligible = bench.filter(p => !p.isInjured && !excludeIds.includes(p.id));
  if (eligible.length === 0) return undefined;

  // 1. Like-for-like
  const exactMatch = eligible.find(p =>
    p.preferredPositions?.includes(position)
  );
  if (exactMatch) return exactMatch;

  // 2. Overlapping zones
  const targetZones = new Set(POSITION_ALLOWED_ZONES[position]);
  const zoneMatch = eligible.find(p =>
    (p.preferredPositions ?? []).some(pp =>
      POSITION_ALLOWED_ZONES[pp].some(z => targetZones.has(z))
    )
  );
  if (zoneMatch) return zoneMatch;

  // 3. Anyone
  return eligible[0];
};

/** Bench = players with no position assigned. */
export const getBench = (players: NetballPlayer[]): NetballPlayer[] =>
  players.filter(p => p.position === null);

/** On-court = players with a position assigned. */
export const getOnCourt = (players: NetballPlayer[]): NetballPlayer[] =>
  players.filter(p => p.position !== null);

/** Returns positions that currently have no player assigned. */
export const getEmptyPositions = (players: NetballPlayer[]): NetballPosition[] => {
  const filled = new Set(players.map(p => p.position).filter(Boolean) as NetballPosition[]);
  return NETBALL_POSITIONS.filter(p => !filled.has(p));
};

/** Player currently in a given position, or undefined. */
export const findPlayerInPosition = (
  players: NetballPlayer[],
  position: NetballPosition
): NetballPlayer | undefined => players.find(p => p.position === position);

/**
 * Apply a snapshot lineup to the player array.
 * Players named in the lineup go on court at their slot;
 * everyone else moves to bench (preserving their stats).
 */
/**
 * Apply a transition to a single player, stamping `lastBenchedAt` whenever
 * they go from on-court → bench so the bench rest timer can render. The
 * stamp is cleared whenever they come back on.
 */
export const transitionPosition = (
  p: NetballPlayer,
  next: NetballPosition | null,
  now: number = Date.now()
): NetballPlayer => {
  const wasOnCourt = p.position !== null;
  const goingToBench = next === null;
  if (wasOnCourt && goingToBench) {
    return { ...p, position: null, lastBenchedAt: now };
  }
  if (!goingToBench && p.lastBenchedAt) {
    return { ...p, position: next, lastBenchedAt: null };
  }
  return { ...p, position: next };
};

export const applyLineup = (
  players: NetballPlayer[],
  lineup: QuarterLineup
): NetballPlayer[] => {
  const positionByPlayerId = new Map<string, NetballPosition>();
  for (const [position, playerId] of Object.entries(lineup.assignments)) {
    if (playerId) positionByPlayerId.set(playerId, position as NetballPosition);
  }
  return players.map(p => transitionPosition(p, positionByPlayerId.get(p.id) ?? null));
};

/** Snapshot the current on-court 7 as a lineup for a quarter. */
export const snapshotLineup = (
  players: NetballPlayer[],
  quarter: Quarter
): QuarterLineup => {
  const assignments: Partial<Record<NetballPosition, string>> = {};
  for (const p of players) {
    if (p.position) assignments[p.position] = p.id;
  }
  return { quarter, assignments, createdAt: Date.now() };
};

/**
 * Generate a time-based rotation plan: every N minutes, rotate one
 * bench player onto court via like-for-like swap.
 * Cycles through bench players to equalise minutes.
 */
/**
 * Pick the bench player who gives the FAIREST swap:
 *   1. Must be eligible (not injured, not already used at this slot)
 *   2. Prefer the player with the LEAST projected court time so far
 *   3. Tie-break by position fit (exact > zone > any)
 *
 * This is the heart of the equal-playing-time algorithm — by always topping up
 * the freshest bench player (rather than the most position-compatible one),
 * minutes converge across the squad.
 */
const pickFairestBenchPlayer = (
  position: NetballPosition,
  bench: NetballPlayer[],
  projectedSeconds: Map<string, number>,
  excludeIds: Set<string>
): NetballPlayer | undefined => {
  const eligible = bench.filter(p => !p.isInjured && !excludeIds.has(p.id));
  if (eligible.length === 0) return undefined;

  const fitRank = (p: NetballPlayer): number => {
    const fit = classifySwapFit(p, position);
    return fit === "exact" ? 0 : fit === "zone" ? 1 : fit === "any" ? 2 : 3;
  };

  // Sort by minutes (asc), then by fit rank (asc). Lowest combined wins.
  return [...eligible].sort((a, b) => {
    const aMin = projectedSeconds.get(a.id) ?? 0;
    const bMin = projectedSeconds.get(b.id) ?? 0;
    if (aMin !== bMin) return aMin - bMin;
    return fitRank(a) - fitRank(b);
  })[0];
};

/**
 * Generate a time-based rotation plan that EQUALISES playing time.
 *
 * Algorithm:
 *  - Simulate the game forward, tracking projected seconds for every player.
 *  - At each interval, sub OUT the on-court player with the MOST projected
 *    minutes, and bring IN the bench player with the LEAST projected minutes.
 *  - Position assignment follows the outgoing player's slot (like-for-like
 *    when possible, but fairness wins ties).
 *
 * This guarantees every available player is cycled through before anyone is
 * subbed twice, and over a full game the spread between most and least
 * minutes converges to ~one interval.
 */
export const generateTimeBasedRotationPlan = (
  players: NetballPlayer[],
  intervalMinutes: number,
  minutesPerQuarter: number,
  periodType: PeriodType = "quarters"
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const intervalSeconds = intervalMinutes * 60;
  const quarterSeconds = minutesPerQuarter * 60;

  // Available roster (exclude injured — they can't take court time).
  const roster = players.filter(p => !p.isInjured);
  if (roster.length <= 7) return plan; // No bench → nothing to rotate.

  // Live simulation state.
  // onCourt: position → playerId
  const onCourt = new Map<NetballPosition, string>();
  for (const p of roster) {
    if (p.position) onCourt.set(p.position, p.id);
  }
  // Bail out if the starting lineup isn't 7 — caller should have validated.
  if (onCourt.size === 0) return plan;

  const projectedSeconds = new Map<string, number>();
  for (const p of roster) projectedSeconds.set(p.id, 0);
  const playerById = new Map(roster.map(p => [p.id, p]));

  /** Advance the simulated clock, crediting on-court players. */
  const advance = (deltaSeconds: number) => {
    if (deltaSeconds <= 0) return;
    for (const id of onCourt.values()) {
      projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + deltaSeconds);
    }
  };

  let lastTickAbsolute = 0; // absolute seconds since game start
  const periods = visiblePeriods(periodType);

  for (let qi = 0; qi < periods.length; qi++) {
    const q = periods[qi] as Quarter;
    const periodStartAbs = qi * quarterSeconds;
    const periodEndAbs = periodStartAbs + quarterSeconds;

    let t = intervalSeconds;
    while (t < quarterSeconds) {
      const absTick = periodStartAbs + t;
      advance(absTick - lastTickAbsolute);
      lastTickAbsolute = absTick;

      // Pick the on-court player with the MOST projected minutes.
      const onCourtList = Array.from(onCourt.entries())
        .map(([position, id]) => ({
          position,
          player: playerById.get(id)!,
          mins: projectedSeconds.get(id) ?? 0,
        }))
        .filter(x => x.player);
      onCourtList.sort((a, b) => b.mins - a.mins);

      // Find the most-played starter who has a fairer bench replacement available.
      // (If everyone's bench replacement is also high-minutes, bail this tick.)
      const benchPlayers = roster.filter(p => !Array.from(onCourt.values()).includes(p.id));
      if (benchPlayers.length === 0) break;
      const minBenchMins = Math.min(...benchPlayers.map(p => projectedSeconds.get(p.id) ?? 0));

      let chosen: { position: NetballPosition; player: NetballPlayer; replacement: NetballPlayer } | null = null;
      for (const candidate of onCourtList) {
        // Only sub if it actually improves fairness (outgoing > incoming).
        if (candidate.mins <= minBenchMins) continue;
        const replacement = pickFairestBenchPlayer(
          candidate.position,
          benchPlayers,
          projectedSeconds,
          new Set()
        );
        if (replacement && (projectedSeconds.get(replacement.id) ?? 0) < candidate.mins) {
          chosen = { position: candidate.position, player: candidate.player, replacement };
          break;
        }
      }

      if (!chosen) {
        // No fair swap available — skip this tick.
        t += intervalSeconds;
        continue;
      }

      onCourt.set(chosen.position, chosen.replacement.id);
      plan.push({
        quarter: q,
        time: t,
        playerOut: chosen.player,
        playerIn: chosen.replacement,
        position: chosen.position,
      });
      t += intervalSeconds;
    }

    // Advance to end of period before moving on.
    advance(periodEndAbs - lastTickAbsolute);
    lastTickAbsolute = periodEndAbs;
  }
  return plan;
};

/**
 * Generate a quarter-break rotation plan that EQUALISES playing time.
 *
 * At each break we credit the period's minutes, then pick the N most-played
 * starters and swap them for the N least-played bench players (subject to
 * position fit). This balances minutes across the whole roster.
 */
export const generateQuarterBreakRotationPlan = (
  players: NetballPlayer[],
  swapsPerBreak = 2,
  periodType: PeriodType = "quarters",
  minutesPerQuarter = 15
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const roster = players.filter(p => !p.isInjured);
  if (roster.length <= 7) return plan;

  const onCourt = new Map<NetballPosition, string>();
  for (const p of roster) {
    if (p.position) onCourt.set(p.position, p.id);
  }
  if (onCourt.size === 0) return plan;

  const projectedSeconds = new Map<string, number>();
  for (const p of roster) projectedSeconds.set(p.id, 0);
  const playerById = new Map(roster.map(p => [p.id, p]));
  const quarterSeconds = minutesPerQuarter * 60;

  const periods = visiblePeriods(periodType) as Quarter[];
  // Credit Q1 minutes before the first break.
  for (const id of onCourt.values()) {
    projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + quarterSeconds);
  }

  // Iterate breaks (start of Q2, Q3, Q4).
  for (let i = 1; i < periods.length; i++) {
    const q = periods[i];
    const usedBenchThisBreak = new Set<string>();

    for (let s = 0; s < swapsPerBreak; s++) {
      const onCourtList = Array.from(onCourt.entries())
        .map(([position, id]) => ({
          position,
          player: playerById.get(id)!,
          mins: projectedSeconds.get(id) ?? 0,
        }))
        .sort((a, b) => b.mins - a.mins);

      const benchPlayers = roster.filter(p =>
        !Array.from(onCourt.values()).includes(p.id) && !usedBenchThisBreak.has(p.id)
      );
      if (benchPlayers.length === 0) break;

      // Find the first starter whose swap actually improves fairness.
      let picked: { position: NetballPosition; player: NetballPlayer; replacement: NetballPlayer } | null = null;
      for (const cand of onCourtList) {
        const replacement = pickFairestBenchPlayer(
          cand.position,
          benchPlayers,
          projectedSeconds,
          usedBenchThisBreak
        );
        if (replacement && (projectedSeconds.get(replacement.id) ?? 0) < cand.mins) {
          picked = { position: cand.position, player: cand.player, replacement };
          break;
        }
      }
      if (!picked) break;

      onCourt.set(picked.position, picked.replacement.id);
      usedBenchThisBreak.add(picked.replacement.id);
      plan.push({
        quarter: q,
        time: 0,
        playerOut: picked.player,
        playerIn: picked.replacement,
        position: picked.position,
      });
    }

    // Credit this period's minutes to whoever's now on court.
    for (const id of onCourt.values()) {
      projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + quarterSeconds);
    }
  }
  return plan;
};

/**
 * Next un-executed sub that's due **in the current quarter only**.
 *
 * Subs from earlier quarters are intentionally NOT cascaded (N1 audit fix).
 * A missed Q1 sub at 5:00 should not fire 30 seconds into Q2 and yank a
 * fresh starter off court. Quarter-break rotations have a separate path
 * via `handleQuarterEnd`.
 */
export const findNextDueSub = (
  plan: NetballSubEvent[],
  currentQuarter: Quarter,
  elapsedSeconds: number
): NetballSubEvent | undefined => {
  return plan
    .filter(s => !s.executed && !s.skipped)
    .find(s => s.quarter === currentQuarter && s.time <= elapsedSeconds);
};

/** Format seconds as MM:SS. */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Storage helpers — kept here so the root component stays thin.
 * Failures are swallowed so a corrupted localStorage entry never bricks the board.
 */
/**
 * Suggest a 7-player lineup for a quarter that:
 *   1. Honours each player's preferredPositions (best fit first)
 *   2. Falls back to zone-compatible candidates
 *   3. Prefers players with the FEWEST minutes already played (fairness)
 *
 * `existingAssignments` lets the caller seed locked positions; suggested
 * picks won't reuse those player ids or overwrite those slots.
 */
export const suggestQuarterLineup = (
  players: NetballPlayer[],
  existingAssignments: Partial<Record<NetballPosition, string>> = {}
): Partial<Record<NetballPosition, string>> => {
  const result: Partial<Record<NetballPosition, string>> = { ...existingAssignments };
  const taken = new Set(Object.values(result).filter(Boolean) as string[]);
  const open = NETBALL_POSITIONS.filter((p) => !result[p]);

  const eligible = players.filter((p) => !p.isInjured);

  // Score each (position, player) pair so we can pick globally-good fits first.
  type Cand = { position: NetballPosition; player: NetballPlayer; score: number };
  const cands: Cand[] = [];
  for (const position of open) {
    for (const player of eligible) {
      if (taken.has(player.id)) continue;
      const fit = classifySwapFit(player, position);
      if (fit === "violation") continue;
      // Lower score is better. Fairness gets the strongest weight.
      const fitWeight = fit === "exact" ? 0 : fit === "zone" ? 100 : 200;
      const minutes = player.minutesPlayed ?? 0;
      cands.push({ position, player, score: fitWeight + minutes });
    }
  }
  cands.sort((a, b) => a.score - b.score);

  for (const c of cands) {
    if (result[c.position] || taken.has(c.player.id)) continue;
    result[c.position] = c.player.id;
    taken.add(c.player.id);
  }
  return result;
};

export const safeLoad = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const safeSave = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
};
