/**
 * Derives event card display content from STRUCTURED fields, not raw titles.
 *
 * Rules:
 *  - Game with opponent → primary "vs {Opponent}", secondary = cleaned title (if meaningful)
 *  - Game w/o opponent  → primary "Game" (or "Match Day" via type label), secondary = cleaned title
 *  - Training           → primary "Training", secondary = cleaned title (if meaningful)
 *  - Social/custom      → primary = title (the only case title drives UI), no secondary
 *
 * Cleans noisy prefixes like "Round 1:", "Game:", "Training:", "Match:".
 */

import { getEventTypeLabel } from "./eventTypeLabel";

interface EventDisplayInput {
  title?: string | null;
  type?: string | null;
  opponent?: string | null;
  mini_league_id?: string | null;
  teams?: { name?: string | null } | null;
  clubs?: { name?: string | null } | null;
}

const NOISY_PREFIX_RE =
  /^\s*(round\s*\d+\s*[:\-–—]?\s*|game\s*[:\-–—]\s*|match\s*[:\-–—]\s*|training\s*[:\-–—]\s*|session\s*[:\-–—]\s*)+/i;

const MATCHUP_SEPARATOR_RE = /\s+(?:v|vs|versus)\.?\s+/i;

function cleanTitle(raw?: string | null): string {
  if (!raw) return "";
  let t = raw.trim();
  // Strip repeated noisy prefixes
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(NOISY_PREFIX_RE, "").trim();
  }
  return t;
}

function isRedundant(secondary: string, primary: string, typeLabel: string): boolean {
  if (!secondary) return true;
  const s = secondary.toLowerCase().trim();
  if (s === primary.toLowerCase().trim()) return true;
  if (s === typeLabel.toLowerCase().trim()) return true;
  // e.g. "Tuesday training" alongside primary "Training" is fine; but "Training" alone is redundant.
  return false;
}

export interface EventDisplay {
  /** Primary scan line — derived from structured fields whenever possible. */
  primary: string;
  /** Optional secondary metadata (the user-entered title, when meaningful). */
  secondary: string | null;
  /** True when the event leads with the title (social/custom only). */
  titleLed: boolean;
}

export function getEventDisplay(event: EventDisplayInput): EventDisplay {
  const type = event.type || "";
  const typeLabel = getEventTypeLabel(type, { miniLeagueId: event.mini_league_id });
  const cleaned = cleanTitle(event.title);
  let opponent = event.opponent?.trim() || "";

  // Fallback: derive opponent from a "Team A vs Team B" title when the
  // structured field is empty. Pick the side that isn't the team/club name.
  if (!opponent && cleaned && MATCHUP_SEPARATOR_RE.test(cleaned)) {
    const [left, right] = cleaned.split(MATCHUP_SEPARATOR_RE).map((s) => s.trim());
    const ownNames = [event.teams?.name, event.clubs?.name]
      .map((n) => (n || "").toLowerCase().trim())
      .filter(Boolean);
    const isOwn = (s: string) =>
      ownNames.some((n) => s.toLowerCase().includes(n) || n.includes(s.toLowerCase()));
    if (left && right) {
      opponent = isOwn(left) && !isOwn(right) ? right : isOwn(right) && !isOwn(left) ? left : right;
    }
  }

  // A. Game / Match Day
  if (type === "game" || type === "mini_league" || event.mini_league_id) {
    if (opponent) {
      const primary = `vs ${opponent}`;
      // Avoid echoing "Team A vs Opponent" titles as secondary
      const secondary =
        cleaned && !MATCHUP_SEPARATOR_RE.test(cleaned) && !isRedundant(cleaned, primary, typeLabel)
          ? cleaned
          : null;
      return { primary, secondary, titleLed: false };
    }
    // No opponent — fall back to type label, expose cleaned title as secondary if meaningful
    const primary = typeLabel; // "Game" or "Match Day"
    const secondary = cleaned && !isRedundant(cleaned, primary, typeLabel) ? cleaned : null;
    return { primary, secondary, titleLed: false };
  }

  // B. Training
  if (type === "training") {
    const primary = "Training";
    const secondary = cleaned && !isRedundant(cleaned, primary, typeLabel) ? cleaned : null;
    return { primary, secondary, titleLed: false };
  }

  // C. Social / custom — title drives the UI
  const primary = cleaned || typeLabel;
  return { primary, secondary: null, titleLed: true };
}
