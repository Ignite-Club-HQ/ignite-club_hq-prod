/**
 * Netball game board types.
 * Kept fully isolated from src/components/pitch/types.ts so the soccer
 * pitch board logic remains untouched.
 */

export type NetballPosition = "GS" | "GA" | "WA" | "C" | "WD" | "GD" | "GK";

export const NETBALL_POSITIONS: NetballPosition[] = ["GS", "GA", "WA", "C", "WD", "GD", "GK"];

export const NETBALL_POSITION_LABELS: Record<NetballPosition, string> = {
  GS: "Goal Shooter",
  GA: "Goal Attack",
  WA: "Wing Attack",
  C: "Centre",
  WD: "Wing Defence",
  GD: "Goal Defence",
  GK: "Goal Keeper",
};

/**
 * Court zones a player is allowed to enter.
 * Court is divided vertically into thirds (attack / centre / defence)
 * with two shooting circles (one inside the attacking third, one inside the
 * defending third).
 */
export type CourtZone =
  | "attack-third"
  | "attack-circle"
  | "centre-third"
  | "defence-third"
  | "defence-circle";

export const POSITION_ALLOWED_ZONES: Record<NetballPosition, CourtZone[]> = {
  GS: ["attack-third", "attack-circle"],
  GA: ["attack-third", "attack-circle", "centre-third"],
  WA: ["attack-third", "centre-third"], // no shooting circle
  C: ["attack-third", "centre-third", "defence-third"], // no circles
  WD: ["centre-third", "defence-third"], // no circle
  GD: ["centre-third", "defence-third", "defence-circle"],
  GK: ["defence-third", "defence-circle"],
};

/** Slot layout (percent of court width/height) for each fixed position. */
export const POSITION_SLOTS: Record<NetballPosition, { x: number; y: number }> = {
  GS: { x: 50, y: 12 },
  GA: { x: 35, y: 28 },
  WA: { x: 65, y: 38 },
  C: { x: 50, y: 50 },
  WD: { x: 35, y: 62 },
  GD: { x: 65, y: 72 },
  GK: { x: 50, y: 88 },
};

export const POSITION_COLORS: Record<NetballPosition, { bg: string; text: string; border: string }> = {
  GS: { bg: "bg-red-500/30", text: "text-red-700 dark:text-red-200", border: "border-red-500" },
  GA: { bg: "bg-orange-500/30", text: "text-orange-700 dark:text-orange-200", border: "border-orange-500" },
  WA: { bg: "bg-amber-500/30", text: "text-amber-700 dark:text-amber-200", border: "border-amber-500" },
  C: { bg: "bg-emerald-500/30", text: "text-emerald-700 dark:text-emerald-200", border: "border-emerald-500" },
  WD: { bg: "bg-sky-500/30", text: "text-sky-700 dark:text-sky-200", border: "border-sky-500" },
  GD: { bg: "bg-indigo-500/30", text: "text-indigo-700 dark:text-indigo-200", border: "border-indigo-500" },
  GK: { bg: "bg-violet-500/30", text: "text-violet-700 dark:text-violet-200", border: "border-violet-500" },
};

export interface NetballPlayer {
  id: string;
  name: string;
  number?: number;
  /** Position currently occupied on court, or null if on bench. */
  position: NetballPosition | null;
  /** Total seconds played (across all quarters). */
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
  /** Coach-set preferred positions for like-for-like rotations. */
  preferredPositions?: NetballPosition[];
  /** Wall-clock timestamp of the last time this player came off court (null = never benched / on court). Used for the bench rest timer. */
  lastBenchedAt?: number | null;
  /** Goals scored (attributable goals — only credited when scored from a quick action by GS/GA). */
  goals?: number;
}

export type Quarter = 1 | 2 | 3 | 4;

/** "Quarters" = 4 periods (default netball). "Halves" = 2 periods (juniors). */
import type { PeriodType } from "@/lib/periodTypes";
export type { PeriodType };

export type RotationMode = "time-based" | "quarter-break" | "off";

export type ValidationMode = "strict" | "warn" | "free";

export interface NetballSubEvent {
  /** Quarter when this sub fires. */
  quarter: Quarter;
  /** Seconds elapsed in the quarter when sub fires. 0 = start of quarter. */
  time: number;
  playerOut: NetballPlayer;
  playerIn: NetballPlayer;
  /** Position the incoming player will take (usually same as playerOut). */
  position: NetballPosition;
  executed?: boolean;
  skipped?: boolean;
}

/** A pre-planned lineup snapshot for one quarter. */
export interface QuarterLineup {
  quarter: Quarter;
  /** Map of position -> player.id */
  assignments: Partial<Record<NetballPosition, string>>;
  createdAt: number;
}

export interface NetballScoreEvent {
  id: string;
  side: "home" | "away";
  points: number;
  quarter: Quarter;
  at: number;
  /** When the goal is attributed to a specific player (home only). */
  playerId?: string;
}

/** Append-only sub log entry — supports undo + post-game review. */
export interface NetballSubLogEntry {
  id: string;
  quarter: Quarter;
  time: number;
  at: number;
  playerOutId: string;
  playerOutName: string;
  playerInId: string;
  playerInName: string;
  position: NetballPosition;
  source: "auto" | "manual";
}

/**
 * Centre-pass log entry. One row per centre pass taken; `converted` flips
 * to true when the side that took the pass scores BEFORE possession changes.
 * Used by CentrePassStatsPanel to compute per-quarter conversion rate.
 */
export interface NetballCentrePassEntry {
  id: string;
  quarter: Quarter;
  /** Side that took the centre pass. */
  side: "home" | "away";
  /** True if this side scored before the centre pass flipped. */
  converted: boolean;
  at: number;
}

export interface NetballTimerState {
  minutesPerQuarter: number;
  currentQuarter: Quarter;
  elapsedSeconds: number;
  isRunning: boolean;
  lastUpdateTime: number;
  isGameFinished?: boolean;
  /** Live score (denormalised totals) */
  homeScore?: number;
  awayScore?: number;
  /** Opponent display name (defaults to "Opponent") */
  opponentName?: string;
  /** Append-only score log to support undo + per-quarter stats */
  scoreLog?: NetballScoreEvent[];
  /** Append-only sub log for undo + post-game review. */
  subLog?: NetballSubLogEntry[];
  /** Coach-selected MVP / Player of the Match (player.id). */
  mvpPlayerId?: string | null;
  /** Which side has the next centre pass. Auto-flips after each goal. */
  centrePass?: "home" | "away";
  /** Append-only centre-pass log used by the stats panel. */
  centrePassLog?: NetballCentrePassEntry[];
  /** Period structure: "quarters" (default, 4 periods) or "halves" (2 periods, junior leagues). */
  periodType?: PeriodType;
}

export interface NetballBoardState {
  teamId: string;
  players: NetballPlayer[];
  currentQuarter: Quarter;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  validationMode: ValidationMode;
  autoSubPlan: NetballSubEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  /** Persisted as plain array (Set isn't JSON-friendly). Coach-locked players exempt from auto-subs. */
  lockedPlayerIds?: string[];
  quarterLineups: QuarterLineup[];
  lastUpdateTime: number;
  linkedEventId?: string | null;
}

/** A reusable, named 7-player unit (e.g. "Starting 7", "Defensive set"). */
export interface NetballLineupPreset {
  id: string;
  name: string;
  /** Map of position -> player.id */
  assignments: Partial<Record<NetballPosition, string>>;
  createdAt: number;
}

export const NETBALL_STATE_KEY_BASE = "ignite-netball-board-state-team";
/** Optionally scope by eventId so each game keeps its own slate (no collision across matches). */
export const getNetballStateKey = (teamId: string, eventId?: string | null) =>
  eventId ? `${NETBALL_STATE_KEY_BASE}-${teamId}-event-${eventId}` : `${NETBALL_STATE_KEY_BASE}-${teamId}`;
export const NETBALL_TIMER_KEY_BASE = "ignite-netball-timer-state-team";
export const getNetballTimerKey = (teamId: string, eventId?: string | null) =>
  eventId ? `${NETBALL_TIMER_KEY_BASE}-${teamId}-event-${eventId}` : `${NETBALL_TIMER_KEY_BASE}-${teamId}`;
export const NETBALL_PRESETS_KEY_BASE = "ignite-netball-presets-team";
/** Presets are coach-level templates → keyed by team only (shared across matches). */
export const getNetballPresetsKey = (teamId: string) => `${NETBALL_PRESETS_KEY_BASE}-${teamId}`;
