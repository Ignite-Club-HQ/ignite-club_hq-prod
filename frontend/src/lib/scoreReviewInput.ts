export type ScoreReviewRecord = { source: "Score" | "History" | "Official record"; orientation: "home-away" | "away-home" | "unknown"; firstScore: string; secondScore: string };
export function parseReviewScore(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) throw new Error("Scores must be whole numbers or left blank for missing values.");
  const score = Number(value);
  if (!Number.isSafeInteger(score) || score > 100000) throw new Error("Scores must be between 0 and 100000.");
  return score;
}
export function prepareScoreRecords(records: ScoreReviewRecord[]) {
  if (records.length < 2 || records.length > 20) throw new Error("Provide 2–20 score records.");
  return records.map(r => ({ ...r, firstScore: parseReviewScore(r.firstScore), secondScore: parseReviewScore(r.secondScore) }));
}