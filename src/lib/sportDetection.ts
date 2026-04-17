/**
 * Sport detection helper - single source of truth for sport-keyword matching.
 * Used by call sites that decide whether to route to the soccer pitch board
 * or the netball game board.
 */

const SOCCER_KEYWORDS = ["soccer", "football", "futsal"];
const NETBALL_KEYWORDS = ["netball"];

const matches = (sport: string | null | undefined, keywords: string[]): boolean => {
  if (!sport) return false;
  const lower = sport.toLowerCase();
  return keywords.some(k => lower.includes(k));
};

export const isSoccerSport = (sport: string | null | undefined): boolean =>
  matches(sport, SOCCER_KEYWORDS);

export const isNetballSport = (sport: string | null | undefined): boolean =>
  matches(sport, NETBALL_KEYWORDS);

export type GameBoardKind = "soccer" | "netball" | null;

export const detectGameBoardKind = (sport: string | null | undefined): GameBoardKind => {
  if (isSoccerSport(sport)) return "soccer";
  if (isNetballSport(sport)) return "netball";
  return null;
};
