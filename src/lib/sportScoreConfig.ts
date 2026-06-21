/**
 * Sport-aware match score configuration.
 *
 * Drives the per-sport labelling and behaviour of the match score card
 * shown on game-type events. The same underlying `game_results` row
 * (home_score / away_score / player_stats jsonb) is used for every
 * sport — only the UI vocabulary changes.
 */

import { isBasketballSport, isNetballSport, isSoccerSport } from "./sportDetection";

export interface SportScoreConfig {
  /** Canonical sport key stored in game_results.sport */
  key: string;
  /** Card heading e.g. "Match Score" */
  title: string;
  /** Singular unit name e.g. "goal", "point", "run" */
  unit: string;
  /** Plural unit name e.g. "goals", "points", "runs" */
  unitPlural: string;
  /** Per-team score field label e.g. "Goals", "Points", "Runs" */
  teamScoreLabel: string;
  /** Heading for the scorers list e.g. "Goal scorers", "Top scorers" */
  scorersLabel: string;
  /** Whether per-player attribution makes sense for this sport */
  supportsScorers: boolean;
  /** Whether to expose the "Own goal (opposition)" option */
  allowOwnGoal: boolean;
  /** Helper text shown beneath the scorers list when empty */
  scorersHint: string;
  /** Max sensible per-team total (used for input max) */
  maxScore: number;
}

const SOCCER: SportScoreConfig = {
  key: "soccer",
  title: "Match Score",
  unit: "goal",
  unitPlural: "goals",
  teamScoreLabel: "Goals",
  scorersLabel: "Goal scorers",
  supportsScorers: true,
  allowOwnGoal: true,
  scorersHint: "Optional — attribute goals to players to track top scorers.",
  maxScore: 99,
};

const NETBALL: SportScoreConfig = {
  ...SOCCER,
  key: "netball",
  title: "Game Score",
  allowOwnGoal: false,
  scorersHint: "Optional — attribute goals to your shooters.",
  maxScore: 200,
};

const BASKETBALL: SportScoreConfig = {
  key: "basketball",
  title: "Game Score",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Top scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record points per player.",
  maxScore: 300,
};

const RUGBY: SportScoreConfig = {
  key: "rugby",
  title: "Match Score",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Try / point scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record points per player.",
  maxScore: 200,
};

const AFL: SportScoreConfig = {
  key: "afl",
  title: "Match Score",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Goal kickers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record goals per player.",
  maxScore: 300,
};

const CRICKET: SportScoreConfig = {
  key: "cricket",
  title: "Match Score",
  unit: "run",
  unitPlural: "runs",
  teamScoreLabel: "Runs",
  scorersLabel: "Top run scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record runs per player.",
  maxScore: 999,
};

const HOCKEY: SportScoreConfig = {
  ...SOCCER,
  key: "hockey",
  scorersHint: "Optional — attribute goals to players.",
  maxScore: 99,
};

const BASEBALL: SportScoreConfig = {
  key: "baseball",
  title: "Game Score",
  unit: "run",
  unitPlural: "runs",
  teamScoreLabel: "Runs",
  scorersLabel: "Top scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record runs per player.",
  maxScore: 99,
};

const VOLLEYBALL: SportScoreConfig = {
  key: "volleyball",
  title: "Match Score",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Top scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record points per player.",
  maxScore: 200,
};

const HANDBALL: SportScoreConfig = {
  ...SOCCER,
  key: "handball",
  unit: "goal",
  unitPlural: "goals",
  scorersHint: "Optional — attribute goals to players.",
  maxScore: 99,
};

const GENERIC: SportScoreConfig = {
  key: "other",
  title: "Match Score",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Score",
  scorersLabel: "Top scorers",
  supportsScorers: true,
  allowOwnGoal: false,
  scorersHint: "Optional — record scorers and their points.",
  maxScore: 999,
};

const lower = (s: string | null | undefined) => (s || "").toLowerCase();
const matchAny = (s: string, kws: string[]) => kws.some((k) => s.includes(k));

/**
 * Pick the right score config for a given club sport string.
 * Falls back to a generic "points" config so any sport an admin types
 * still gets a usable score entry experience.
 */
export const getSportScoreConfig = (sport: string | null | undefined): SportScoreConfig => {
  if (isSoccerSport(sport)) return SOCCER;
  if (isBasketballSport(sport)) return BASKETBALL;
  if (isNetballSport(sport)) return NETBALL;
  const s = lower(sport);
  if (!s) return GENERIC;
  if (matchAny(s, ["rugby", "league", "union"])) return RUGBY;
  if (matchAny(s, ["afl", "aussie", "australian rules"])) return AFL;
  if (matchAny(s, ["cricket"])) return CRICKET;
  if (matchAny(s, ["hockey"])) return HOCKEY;
  if (matchAny(s, ["baseball", "softball", "tee ball", "t-ball"])) return BASEBALL;
  if (matchAny(s, ["volleyball"])) return VOLLEYBALL;
  if (matchAny(s, ["handball"])) return HANDBALL;
  return GENERIC;
};
