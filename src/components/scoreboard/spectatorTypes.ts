/**
 * Shared types + helpers for the cross-device spectator / Subs Manager view.
 *
 * The spectator path subscribes to the `active_games` row written by the
 * coach's board (basketball or netball), and projects that row back into
 * the same shape the active board uses for rendering.
 *
 * Centralising the contract here means the future BasketballSpectator and
 * NetballSpectator hooks share one schema (and one set of bug fixes).
 */

import type {
  BasketballBoardState,
  BasketballTimerState,
} from "@/components/basketball/types";
import type {
  NetballBoardState,
  NetballTimerState,
} from "@/components/netball/types";

export type SpectatorSport = "basketball" | "netball" | "soccer";

export interface BasketballSpectatorState {
  sport: "basketball";
  board: Partial<BasketballBoardState>;
  timer: Partial<BasketballTimerState>;
  /** Wall-clock timestamp of the most recent `active_games.updated_at` we've seen. */
  receivedAt: number;
}

export interface NetballSpectatorState {
  sport: "netball";
  board: Partial<NetballBoardState>;
  timer: Partial<NetballTimerState>;
  receivedAt: number;
}

export interface SoccerSpectatorState {
  sport: "soccer";
  /** Raw pitch_state payload — soccer players + autoSub plan. */
  board: Record<string, unknown>;
  /** Raw timer_state payload — elapsedSeconds, currentHalf, etc. */
  timer: Record<string, unknown>;
  receivedAt: number;
}

export type CourtSpectatorState =
  | BasketballSpectatorState
  | NetballSpectatorState
  | SoccerSpectatorState;

/** Default poll interval for spectator views. Matches the SYNC_INTERVAL on the coach side. */
export const SPECTATOR_POLL_INTERVAL_MS = 10_000;

/**
 * Decide whether the spectator view should still consider a feed "live".
 * Coaches sometimes background the app — we keep the feed alive for ~3
 * sync intervals before showing a "spectator paused" state.
 */
export const SPECTATOR_STALE_THRESHOLD_MS = SPECTATOR_POLL_INTERVAL_MS * 3;

export function isSpectatorFeedStale(receivedAt: number, now = Date.now()): boolean {
  return now - receivedAt > SPECTATOR_STALE_THRESHOLD_MS;
}
