/**
 * Basketball game board types.
 * Fully isolated from soccer (`pitch/types.ts`) and netball (`netball/types.ts`)
 * so the existing boards remain untouched.
 *
 * Positions are SOFT roles: any player can occupy any slot. Validation modes
 * exist only for "Structured Mode" coaches who want one player per role.
 */

export type BasketballPosition = "PG" | "SG" | "SF" | "PF" | "C";

export const BASKETBALL_POSITIONS: BasketballPosition[] = ["PG", "SG", "SF", "PF", "C"];

export const BASKETBALL_POSITION_LABELS: Record<BasketballPosition, string> = {
  PG: "Point Guard",
  SG: "Shooting Guard",
  SF: "Small Forward",
  PF: "Power Forward",
  C: "Centre",
};

/**
 * Default visual slot positions on a half-court SVG (100x140 viewBox, portrait).
 * These are visual hints only — players may be moved freely between slots.
 *
 * Layout (top of court = hoop end):
 *   PG = top of the key (ball handler)
 *   SG = right wing
 *   SF = left wing
 *   PF = right block
 *   C  = under the basket
 */
export const POSITION_SLOTS: Record<BasketballPosition, { x: number; y: number }> = {
  PG: { x: 50, y: 75 },
  SG: { x: 78, y: 55 },
  SF: { x: 22, y: 55 },
  PF: { x: 70, y: 28 },
  C:  { x: 50, y: 18 },
};

/**
 * Full-court slot positions (100x100 viewBox). Players are clustered in the
 * top half (offensive end) so the bottom half stays visually clear.
 */
export const POSITION_SLOTS_FULL: Record<BasketballPosition, { x: number; y: number }> = {
  PG: { x: 50, y: 42 },
  SG: { x: 75, y: 32 },
  SF: { x: 25, y: 32 },
  PF: { x: 65, y: 18 },
  C:  { x: 50, y: 12 },
};

export const POSITION_COLORS: Record<BasketballPosition, { bg: string; text: string; border: string }> = {
  PG: { bg: "bg-amber-500/30",   text: "text-amber-700 dark:text-amber-200",   border: "border-amber-500" },
  SG: { bg: "bg-orange-500/30",  text: "text-orange-700 dark:text-orange-200", border: "border-orange-500" },
  SF: { bg: "bg-emerald-500/30", text: "text-emerald-700 dark:text-emerald-200", border: "border-emerald-500" },
  PF: { bg: "bg-sky-500/30",     text: "text-sky-700 dark:text-sky-200",         border: "border-sky-500" },
  C:  { bg: "bg-violet-500/30",  text: "text-violet-700 dark:text-violet-200",   border: "border-violet-500" },
};

export interface BasketballPlayer {
  id: string;
  name: string;
  number?: number;
  /** Position currently occupied on court, or null if on bench. */
  position: BasketballPosition | null;
  /** Total seconds played (across all quarters). */
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
  /** Coach-set preferred positions for like-for-like rotations / structured mode. */
  preferredPositions?: BasketballPosition[];
  /** Foul count (0-5/6 depending on league — we just track the number). */
  fouls?: number;
  /** Locked out via foul-out (≥5 fouls FIBA / ≥6 NBA). Distinct from injury. */
  isFouledOut?: boolean;
  /** Total points scored by this player across the game. */
  points?: number;
  /** Free-throw makes this game (each make = 1 point, already added to `points`). */
  ftMade?: number;
  /** Free-throw attempts this game (used to display FT%). */
  ftAttempted?: number;
  /** Wall-clock timestamp of the last time this player came off court (null = never benched / on court). Used for the bench rest timer. */
  lastBenchedAt?: number | null;
}

/** "Quarters" = 4 periods (default basketball). "Halves" = 2 periods (younger leagues). */
import type { PeriodType } from "@/lib/periodTypes";
export type { PeriodType };

export type Quarter = 1 | 2 | 3 | 4;

export type RotationMode = "time-based" | "quarter-break" | "off";

/**
 * Basketball is intentionally permissive:
 *  - "free" → no checks at all (default, esp. juniors / positionless ball)
 *  - "structured" → warn when two players share the same role
 */
export type ValidationMode = "free" | "structured";

export interface BasketballSubEvent {
  quarter: Quarter;
  /** Seconds elapsed in the quarter when sub fires. 0 = start of quarter. */
  time: number;
  playerOut: BasketballPlayer;
  playerIn: BasketballPlayer;
  position: BasketballPosition;
  executed?: boolean;
  skipped?: boolean;
}

/** A pre-planned 5-player snapshot for one quarter. */
export interface QuarterLineup {
  quarter: Quarter;
  /** Map of position -> player.id */
  assignments: Partial<Record<BasketballPosition, string>>;
  createdAt: number;
}

export interface ScoreEvent {
  id: string;
  side: "home" | "away";
  points: number;
  quarter: Quarter;
  at: number;
  /** Player credited with the basket (home side only). */
  playerId?: string;
}

/** Append-only sub log entry — supports undo + post-game review. */
export interface SubLogEntry {
  id: string;
  quarter: Quarter;
  /** Seconds elapsed in the quarter when sub fired. */
  time: number;
  /** Wall-clock timestamp. */
  at: number;
  playerOutId: string;
  playerOutName: string;
  playerInId: string;
  playerInName: string;
  position: BasketballPosition;
  /** "auto" = fired by rotation plan; "manual" = coach action. */
  source: "auto" | "manual";
}

export interface BasketballTimerState {
  minutesPerQuarter: number;
  currentQuarter: Quarter;
  elapsedSeconds: number;
  isRunning: boolean;
  lastUpdateTime: number;
  isGameFinished?: boolean;
  /** Live score (denormalised total for fast read) */
  homeScore?: number;
  awayScore?: number;
  /** Opponent display name (defaults to "Opponent") */
  opponentName?: string;
  /** Append-only score log to support undo + per-quarter stats */
  scoreLog?: ScoreEvent[];
  /** Append-only sub log to support undo + post-game review. */
  subLog?: SubLogEntry[];
  /** Coach-selected MVP / Player of the Match (player.id). */
  mvpPlayerId?: string | null;
  /** Per-half timeout allowance (FIBA default = 2 H1 / 3 H2; we treat as a single number). */
  timeoutsPerHalf?: number;
  /** Remaining timeouts in the current half for each team. */
  homeTimeoutsRemaining?: number;
  awayTimeoutsRemaining?: number;
  /** Tracks which half we last reset timeouts for (auto-reset on Q3 start). */
  timeoutsHalfTracked?: 1 | 2;
  /** Period structure: "quarters" (default, 4 periods) or "halves" (2 periods, junior leagues). */
  periodType?: PeriodType;
}

export interface BasketballBoardState {
  teamId: string;
  players: BasketballPlayer[];
  currentQuarter: Quarter;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  validationMode: ValidationMode;
  autoSubPlan: BasketballSubEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  /** Persisted set of locked player IDs (excluded from auto-sub). */
  lockedPlayerIds?: string[];
  quarterLineups: QuarterLineup[];
  lastUpdateTime: number;
  linkedEventId?: string | null;
}

/** A reusable, named 5-player unit (e.g. "Starters", "Bench mob"). */
export interface BasketballLineupPreset {
  id: string;
  name: string;
  /** Map of position -> player.id */
  assignments: Partial<Record<BasketballPosition, string>>;
  createdAt: number;
}

export type BasketballCourtView = "half" | "full";

export const BASKETBALL_STATE_KEY_BASE = "ignite-basketball-board-state-team";
/** Optionally scope by eventId so each game keeps its own slate (no collision across matches). */
export const getBasketballStateKey = (teamId: string, eventId?: string | null) =>
  eventId ? `${BASKETBALL_STATE_KEY_BASE}-${teamId}-event-${eventId}` : `${BASKETBALL_STATE_KEY_BASE}-${teamId}`;
export const BASKETBALL_TIMER_KEY_BASE = "ignite-basketball-timer-state-team";
export const getBasketballTimerKey = (teamId: string, eventId?: string | null) =>
  eventId ? `${BASKETBALL_TIMER_KEY_BASE}-${teamId}-event-${eventId}` : `${BASKETBALL_TIMER_KEY_BASE}-${teamId}`;
export const BASKETBALL_PRESETS_KEY_BASE = "ignite-basketball-presets-team";
/** Presets are coach-level templates → keyed by team only (shared across matches). */
export const getBasketballPresetsKey = (teamId: string) => `${BASKETBALL_PRESETS_KEY_BASE}-${teamId}`;
