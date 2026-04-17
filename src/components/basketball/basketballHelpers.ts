/**
 * Pure helpers for the basketball game board.
 * No React, no side effects.
 */
import {
  BasketballPlayer,
  BasketballPosition,
  BasketballSubEvent,
  Quarter,
  QuarterLineup,
  BASKETBALL_POSITIONS,
} from "./types";

export const getSubKey = (sub: BasketballSubEvent): string =>
  `${sub.quarter}-${sub.time}-${sub.playerOut.id}-${sub.position}`;

/**
 * Basketball positions are SOFT — every player is eligible everywhere.
 * Preferred positions are used only as a hint for like-for-like swaps.
 */
export const isPositionAllowedForPlayer = (): boolean => true;

/**
 * Pick a like-for-like bench candidate. Preference order:
 *   1. Bench player whose preferredPositions includes the target position
 *   2. Bench player with FEWEST minutes played (equal-time philosophy)
 */
export const pickLikeForLikeBenchPlayer = (
  position: BasketballPosition,
  bench: BasketballPlayer[],
  excludeIds: string[] = []
): BasketballPlayer | undefined => {
  const eligible = bench.filter(
    p => !p.isInjured && !p.isFouledOut && !excludeIds.includes(p.id)
  );
  if (eligible.length === 0) return undefined;

  const preferred = eligible.filter(p => p.preferredPositions?.includes(position));
  const pool = preferred.length > 0 ? preferred : eligible;

  // Lowest minutes first → fairness.
  return [...pool].sort((a, b) => (a.minutesPlayed ?? 0) - (b.minutesPlayed ?? 0))[0];
};

export const getBench = (players: BasketballPlayer[]): BasketballPlayer[] =>
  players.filter(p => p.position === null);

export const getOnCourt = (players: BasketballPlayer[]): BasketballPlayer[] =>
  players.filter(p => p.position !== null);

export const getEmptyPositions = (players: BasketballPlayer[]): BasketballPosition[] => {
  const filled = new Set(players.map(p => p.position).filter(Boolean) as BasketballPosition[]);
  return BASKETBALL_POSITIONS.filter(p => !filled.has(p));
};

export const findPlayerInPosition = (
  players: BasketballPlayer[],
  position: BasketballPosition
): BasketballPlayer | undefined => players.find(p => p.position === position);

export const applyLineup = (
  players: BasketballPlayer[],
  lineup: QuarterLineup
): BasketballPlayer[] => {
  const positionByPlayerId = new Map<string, BasketballPosition>();
  for (const [position, playerId] of Object.entries(lineup.assignments)) {
    if (playerId) positionByPlayerId.set(playerId, position as BasketballPosition);
  }
  return players.map(p => ({
    ...p,
    position: positionByPlayerId.get(p.id) ?? null,
  }));
};

export const snapshotLineup = (
  players: BasketballPlayer[],
  quarter: Quarter
): QuarterLineup => {
  const assignments: Partial<Record<BasketballPosition, string>> = {};
  for (const p of players) {
    if (p.position) assignments[p.position] = p.id;
  }
  return { quarter, assignments, createdAt: Date.now() };
};

/**
 * Time-based rotation: every N minutes, swap the highest-minutes on-court
 * player with the lowest-minutes bench player (equal time philosophy).
 * Basketball is high-tempo — keep the pool moving.
 */
export const generateTimeBasedRotationPlan = (
  players: BasketballPlayer[],
  intervalMinutes: number,
  minutesPerQuarter: number
): BasketballSubEvent[] => {
  const plan: BasketballSubEvent[] = [];
  const intervalSeconds = intervalMinutes * 60;
  const quarterSeconds = minutesPerQuarter * 60;

  for (let q = 1; q <= 4; q++) {
    let t = intervalSeconds;
    while (t < quarterSeconds) {
      const bench = getBench(players);
      if (bench.length === 0) break;
      const onCourt = getOnCourt(players);
      const sortedOnCourt = [...onCourt].sort(
        (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
      );
      const playerOut = sortedOnCourt[0];
      if (!playerOut || !playerOut.position) break;
      const candidate = pickLikeForLikeBenchPlayer(
        playerOut.position,
        bench,
        plan.filter(s => s.quarter === q).map(s => s.playerIn.id)
      );
      if (!candidate) break;
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
 * Quarter-break rotation: at the start of Q2/Q3/Q4, swap N bench players in.
 * Basketball coaches typically rotate aggressively at breaks — default 3.
 */
export const generateQuarterBreakRotationPlan = (
  players: BasketballPlayer[],
  swapsPerBreak = 3
): BasketballSubEvent[] => {
  const plan: BasketballSubEvent[] = [];
  const bench = getBench(players);
  if (bench.length === 0) return plan;

  for (const q of [2, 3, 4] as Quarter[]) {
    const onCourt = getOnCourt(players);
    const sortedOnCourt = [...onCourt].sort(
      (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
    );
    for (let i = 0; i < Math.min(swapsPerBreak, bench.length); i++) {
      const playerOut = sortedOnCourt[i];
      if (!playerOut || !playerOut.position) continue;
      const candidate = pickLikeForLikeBenchPlayer(
        playerOut.position,
        bench,
        plan.filter(s => s.quarter === q).map(s => s.playerIn.id)
      );
      if (!candidate) continue;
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

export const findNextDueSub = (
  plan: BasketballSubEvent[],
  currentQuarter: Quarter,
  elapsedSeconds: number
): BasketballSubEvent | undefined => {
  return plan
    .filter(s => !s.executed && !s.skipped)
    .find(s =>
      s.quarter < currentQuarter ||
      (s.quarter === currentQuarter && s.time <= elapsedSeconds)
    );
};

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
