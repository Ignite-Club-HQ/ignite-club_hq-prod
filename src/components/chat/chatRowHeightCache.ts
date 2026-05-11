/**
 * In-memory LRU cache of measured row heights, keyed by message id.
 *
 * Virtuoso re-measures rows every time they remount after being scrolled out
 * of the overscan window, then it falls back to `defaultItemHeight` for any
 * row it has never measured in this session. On long histories that means a
 * fast upward fling repeatedly trades the current `estimateChatRowHeight()`
 * value for the eventual real measurement, and Virtuoso patches `paddingTop`
 * each time — the residual visible jolt.
 *
 * Caching the real measured height across remounts lets the estimator return
 * the exact previous height the second time a row is visited, eliminating
 * the post-measure correction entirely for any row the user has already seen.
 *
 * The cache is process-local and bounded (~2000 entries) so it cannot grow
 * unbounded across long sessions. Entries are evicted in insertion order
 * (Map iteration order). 2000 rows ≈ ~6 weeks of an active team chat.
 */

const MAX_ENTRIES = 2000;
const cache = new Map<string, number>();

export function getCachedRowHeight(id: string | null | undefined): number | undefined {
  if (!id) return undefined;
  const v = cache.get(id);
  if (v === undefined) return undefined;
  // Touch for LRU: re-insert moves the entry to the most-recent position in
  // Map iteration order so the next eviction targets a stale row instead.
  cache.delete(id);
  cache.set(id, v);
  return v;
}

export function setCachedRowHeight(id: string | null | undefined, height: number) {
  if (!id) return;
  if (!Number.isFinite(height) || height <= 0) return;
  // Snap to integer — Virtuoso's measurement comes from `offsetHeight` which
  // is already integer, but guard against accidental floats.
  const next = Math.round(height);
  const prev = cache.get(id);
  if (prev === next) {
    // Touch for LRU without churning insertion when the value is unchanged.
    cache.delete(id);
    cache.set(id, next);
    return;
  }
  cache.set(id, next);
  if (cache.size > MAX_ENTRIES) {
    // Evict the oldest entry (first in insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

export function invalidateCachedRowHeight(id: string | null | undefined) {
  if (!id) return;
  cache.delete(id);
}

export function clearChatRowHeightCache() {
  cache.clear();
}

/** Test/debug accessor — current cache size. */
export function getChatRowHeightCacheSize() {
  return cache.size;
}
