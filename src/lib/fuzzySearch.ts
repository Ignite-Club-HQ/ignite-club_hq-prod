/**
 * Lightweight fuzzy matcher for vault search (folders/files).
 *
 * Returns a score and the matched character indices so callers can highlight
 * matched letters. Score is higher for:
 *  - exact substring matches
 *  - matches at the start of the string or word boundaries
 *  - consecutive matches
 *
 * Returns null when the query characters are not all present in order.
 */

export interface FuzzyMatch {
  score: number;
  indices: number[];
}

export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };
  if (!text) return null;

  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, indices: [] };

  // Exact substring → high score, boost if at start.
  const exact = t.indexOf(q);
  if (exact !== -1) {
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(exact + i);
    let score = 1000 - exact * 2 + q.length * 4;
    if (exact === 0) score += 200;
    else if (/[\s._\-/]/.test(t[exact - 1] || "")) score += 100;
    return { score, indices };
  }

  // Subsequence walk
  const indices: number[] = [];
  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatchedAt = -2;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      let bonus = 10;
      if (ti === prevMatchedAt + 1) {
        consecutive++;
        bonus += consecutive * 8;
      } else {
        consecutive = 0;
      }
      if (ti === 0) bonus += 40;
      else if (/[\s._\-/]/.test(t[ti - 1] || "")) bonus += 25;
      score += bonus;
      prevMatchedAt = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return null;

  // Penalize long strings with sparse matches
  score -= Math.max(0, t.length - q.length) * 0.2;
  return { score, indices };
}

export function fuzzyFilter<T>(
  items: T[] | undefined | null,
  query: string,
  getText: (item: T) => string,
): T[] {
  if (!items) return [];
  if (!query.trim()) return items;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const m = fuzzyMatch(getText(item) || "", query);
    if (m) scored.push({ item, score: m.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

/**
 * High-confidence fuzzy predicate.
 *
 * Rules (per whitespace token, all must pass):
 *  - Substring match → always passes.
 *  - Otherwise allow at most 1 typo (Levenshtein ≤ 1) against any word in the
 *    text whose length is within ±2 of the token. Tokens shorter than 4 chars
 *    require an exact substring match (no typo tolerance) to avoid noise like
 *    "and" matching "android" inside arbitrary prose — wait, that IS desired;
 *    the noise issue is the opposite: short queries doing loose subsequence
 *    matches across unrelated letters. So we drop subsequence entirely.
 *
 * This eliminates false positives like "Android" matching "thanks already
 * from it reads" via scattered subsequence letters.
 */
function levenshteinLE1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Ensure la <= lb
  if (la > lb) return levenshteinLE1(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (la === lb) {
        i++;
        j++;
      } else {
        j++;
      }
    }
  }
  if (j < lb) edits += lb - j;
  return edits <= 1;
}

export function fuzzyMatchesQuery(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (t.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.every((tok) => {
    if (t.includes(tok)) return true;
    // Typo tolerance only for tokens long enough to be unambiguous.
    if (tok.length < 4) return false;
    return words.some((w) => {
      if (Math.abs(w.length - tok.length) > 1) return false;
      return levenshteinLE1(w, tok);
    });
  });
}
