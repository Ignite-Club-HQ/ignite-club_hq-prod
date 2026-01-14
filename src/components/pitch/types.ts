import { PitchPosition } from "./PositionBadge";

export interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null; // null = on bench
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number; // Total seconds played (displayed as minutes)
  isInjured?: boolean; // Player is injured and cannot be subbed on
  isFillIn?: boolean; // Temporary fill-in player (not part of regular team roster)
}

export interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

export type TeamSize = "4" | "7" | "9" | "11";
export type DrawingTool = "none" | "pen" | "arrow";

// Formation definitions
export const FORMATIONS: Record<TeamSize, { name: string; positions: { x: number; y: number }[] }[]> = {
  "4": [
    { name: "1-2-1", positions: [{ x: 50, y: 85 }, { x: 25, y: 55 }, { x: 75, y: 55 }, { x: 50, y: 25 }] },
    { name: "2-1-1", positions: [{ x: 35, y: 85 }, { x: 65, y: 85 }, { x: 50, y: 55 }, { x: 50, y: 25 }] },
    { name: "1-1-2", positions: [{ x: 50, y: 85 }, { x: 50, y: 55 }, { x: 35, y: 25 }, { x: 65, y: 25 }] },
  ],
  "7": [
    { name: "2-3-1", positions: [{ x: 50, y: 90 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 20, y: 45 }, { x: 50, y: 45 }, { x: 80, y: 45 }, { x: 50, y: 20 }] },
    { name: "3-2-1", positions: [{ x: 50, y: 90 }, { x: 25, y: 70 }, { x: 50, y: 70 }, { x: 75, y: 70 }, { x: 35, y: 40 }, { x: 65, y: 40 }, { x: 50, y: 15 }] },
    { name: "2-2-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 30, y: 40 }, { x: 70, y: 40 }, { x: 35, y: 15 }, { x: 65, y: 15 }] },
  ],
  "9": [
    { name: "3-3-2", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
    { name: "3-2-3", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 35, y: 48 }, { x: 65, y: 48 }, { x: 25, y: 20 }, { x: 50, y: 20 }, { x: 75, y: 20 }] },
    { name: "2-4-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 72 }, { x: 70, y: 72 }, { x: 20, y: 48 }, { x: 40, y: 48 }, { x: 60, y: 48 }, { x: 80, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
  ],
  "11": [
    { name: "4-4-2", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 20, y: 50 }, { x: 40, y: 50 }, { x: 60, y: 50 }, { x: 80, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "4-3-3", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 30, y: 50 }, { x: 50, y: 50 }, { x: 70, y: 50 }, { x: 25, y: 22 }, { x: 50, y: 22 }, { x: 75, y: 22 }] },
    { name: "3-5-2", positions: [{ x: 50, y: 92 }, { x: 25, y: 75 }, { x: 50, y: 75 }, { x: 75, y: 75 }, { x: 15, y: 50 }, { x: 35, y: 50 }, { x: 50, y: 50 }, { x: 65, y: 50 }, { x: 85, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "4-2-3-1", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 35, y: 55 }, { x: 65, y: 55 }, { x: 25, y: 35 }, { x: 50, y: 35 }, { x: 75, y: 35 }, { x: 50, y: 15 }] },
  ],
};

// Map formation positions to pitch positions based on Y coordinate
export const getPositionFromCoords = (y: number, teamSize: TeamSize): PitchPosition => {
  // 4-a-side has no goalkeeper - all outfield positions
  if (teamSize === "4") {
    if (y > 70) return "DEF";
    if (y > 40) return "MID";
    return "FWD";
  }
  // GK is always at the back (y > 80) for other team sizes
  if (y > 80) return "GK";
  // Defenders (y > 60)
  if (y > 60) return "DEF";
  // Midfielders (y > 30)
  if (y > 30) return "MID";
  // Forwards (y <= 30)
  return "FWD";
};

// Local storage keys
export const PITCH_STATE_KEY = "ignite-pitch-board-state";
export const PITCH_BOARD_OPEN_KEY = "ignite-pitch-board-open";
export const TIMER_STORAGE_KEY = 'pitch-board-timer-state';

// Goal tracking interface
export interface Goal {
  id: string;
  scorerId?: string; // Player ID who scored (optional for opponent goals)
  scorerName?: string; // Player name (for display)
  time: number; // Game seconds when scored
  half: 1 | 2;
  isOpponentGoal: boolean;
}

// Pitch board state persistence interface
export interface PitchBoardState {
  teamId: string;
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition: { x: number; y: number };
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  mockMode: boolean;
  lastUpdateTime: number;
  lastTimerSeconds?: number;
  linkedEventId?: string | null; // Link to a game event for stats tracking
  executedSubs?: SubstitutionEvent[]; // Track executed substitutions for stats
  goals?: Goal[]; // Track goals scored during the game
}

export interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
}
