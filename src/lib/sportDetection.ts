/**
 * Sport detection helper - single source of truth for sport-keyword matching.
 * Used by call sites that decide whether to route to the soccer pitch board,
 * the netball game board, or the basketball game board.
 */

const SOCCER_KEYWORDS = ["soccer", "football", "futsal"];
const NETBALL_KEYWORDS = ["netball"];
const BASKETBALL_KEYWORDS = ["basketball", "basket ball", "hoops"];

const matches = (sport: string | null | undefined, keywords: string[]): boolean => {
  if (!sport) return false;
  const lower = sport.toLowerCase();
  return keywords.some(k => lower.includes(k));
};

export const isSoccerSport = (sport: string | null | undefined): boolean =>
  matches(sport, SOCCER_KEYWORDS);

export const isNetballSport = (sport: string | null | undefined): boolean =>
  matches(sport, NETBALL_KEYWORDS);

export const isBasketballSport = (sport: string | null | undefined): boolean =>
  matches(sport, BASKETBALL_KEYWORDS);

export type GameBoardKind = "soccer" | "netball" | "basketball" | null;

export const detectGameBoardKind = (sport: string | null | undefined): GameBoardKind => {
  // Order matters: check basketball before soccer because "basketball" doesn't
  // contain "football" but we keep precedence explicit.
  if (isBasketballSport(sport)) return "basketball";
  if (isNetballSport(sport)) return "netball";
  if (isSoccerSport(sport)) return "soccer";
  return null;
};
