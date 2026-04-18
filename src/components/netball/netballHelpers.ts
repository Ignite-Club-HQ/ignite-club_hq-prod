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
export const generateTimeBasedRotationPlan = (
  players: NetballPlayer[],
  intervalMinutes: number,
  minutesPerQuarter: number
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const intervalSeconds = intervalMinutes * 60;
  const quarterSeconds = minutesPerQuarter * 60;

  // Track a rolling bench rotation index so we cycle through fairly.
  let benchCursor = 0;

  for (let q = 1; q <= 4; q++) {
    let t = intervalSeconds;
    while (t < quarterSeconds) {
      const bench = getBench(players);
      if (bench.length === 0) break;
      const onCourt = getOnCourt(players);
      // Pick the on-court player with the most accumulated minutes
      // we haven't already scheduled out at this slot.
      const sortedOnCourt = [...onCourt].sort(
        (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
      );
      const playerOut = sortedOnCourt[0];
      if (!playerOut || !playerOut.position) break;
      const candidate = pickLikeForLikeBenchPlayer(
        playerOut.position,
        bench,
        plan.filter(s => s.quarter === q).map(s => s.playerIn.id)
      ) ?? bench[benchCursor % bench.length];
      benchCursor++;
      plan.push({
        quarter: q as Quarter,
        time: t,
        playerOut,
        playerIn: candidate,
        position: playerOut.position,
      });
      t += intervalSeconds;
    }
  }
  return plan;
};

/**
 * Generate a quarter-break rotation plan:
 * at the start of Q2, Q3, Q4 rotate up to N bench players onto court.
 */
export const generateQuarterBreakRotationPlan = (
  players: NetballPlayer[],
  swapsPerBreak = 2
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const bench = getBench(players);
  if (bench.length === 0) return plan;

  let benchCursor = 0;
  for (const q of [2, 3, 4] as Quarter[]) {
    const onCourt = getOnCourt(players);
    const sortedOnCourt = [...onCourt].sort(
      (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
    );
    for (let i = 0; i < Math.min(swapsPerBreak, bench.length); i++) {
      const playerOut = sortedOnCourt[i];
      if (!playerOut || !playerOut.position) continue;
      const candidate =
        pickLikeForLikeBenchPlayer(
          playerOut.position,
          bench,
          plan.filter(s => s.quarter === q).map(s => s.playerIn.id)
        ) ?? bench[benchCursor % bench.length];
      benchCursor++;
      plan.push({
        quarter: q,
        time: 0,
        playerOut,
        playerIn: candidate,
        position: playerOut.position,
      });
    }
  }
  return plan;
};

/** Compute the next due sub given current quarter+elapsed. */
export const findNextDueSub = (
  plan: NetballSubEvent[],
  currentQuarter: Quarter,
  elapsedSeconds: number
): NetballSubEvent | undefined => {
  return plan
    .filter(s => !s.executed && !s.skipped)
    .find(s =>
      s.quarter < currentQuarter ||
      (s.quarter === currentQuarter && s.time <= elapsedSeconds)
    );
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
