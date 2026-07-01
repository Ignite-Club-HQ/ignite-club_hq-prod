/**
 * Shared, module-level cache for `profiles` lookups by id.
 *
 * Purpose: cut repeated `profiles WHERE id = ANY(...)` fanouts (the top
 * total-time query in pg_stat_statements) by:
 *   1. Serving hot rows from memory (5 min TTL).
 *   2. De-duplicating concurrent requests for the same ids across the whole app.
 *   3. Coalescing rapid-fire calls into a single batched fetch (10ms window).
 *
 * Safe by design:
 *   - TTL keeps drift bounded (avatar/name edits self-heal within 5min).
 *   - Realtime updates to `profiles` already flow via useAuth; consumers that
 *     need instant freshness can call `invalidateProfileCache(id)`.
 *   - No writes, no auth changes, no RLS interaction — pure read memoisation.
 */

import { supabase } from "@/integrations/supabase/client";

export interface CachedProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const TTL_MS = 5 * 60 * 1000;
const BATCH_WINDOW_MS = 10;

interface Entry {
  profile: CachedProfile | null;
  fetchedAt: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedProfile | null>>();

let pendingIds = new Set<string>();
let pendingResolvers = new Map<
  string,
  Array<(p: CachedProfile | null) => void>
>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
}

async function flushBatch() {
  flushTimer = null;
  const ids = Array.from(pendingIds);
  const resolvers = pendingResolvers;
  pendingIds = new Set();
  pendingResolvers = new Map();
  if (ids.length === 0) return;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", ids);

    if (error) throw error;

    const now = Date.now();
    const byId = new Map<string, CachedProfile>();
    for (const p of data ?? []) {
      byId.set(p.id, p as CachedProfile);
    }

    for (const id of ids) {
      const profile = byId.get(id) ?? null;
      cache.set(id, { profile, fetchedAt: now });
      inFlight.delete(id);
      const cbs = resolvers.get(id) ?? [];
      for (const cb of cbs) cb(profile);
    }
  } catch (err) {
    // Fail-open: resolve with null so callers don't hang; do NOT cache failures.
    for (const id of ids) {
      inFlight.delete(id);
      const cbs = resolvers.get(id) ?? [];
      for (const cb of cbs) cb(null);
    }
    // eslint-disable-next-line no-console
    console.warn("[profileCache] batch fetch failed", err);
  }
}

function requestOne(id: string): Promise<CachedProfile | null> {
  const existing = inFlight.get(id);
  if (existing) return existing;

  const p = new Promise<CachedProfile | null>((resolve) => {
    pendingIds.add(id);
    const arr = pendingResolvers.get(id) ?? [];
    arr.push(resolve);
    pendingResolvers.set(id, arr);
    scheduleFlush();
  });
  inFlight.set(id, p);
  return p;
}

/**
 * Fetch profiles for the given ids. Returns a Map keyed by id.
 * Cached entries served instantly; misses batched into a single query.
 */
export async function fetchProfilesByIds(
  ids: readonly string[],
): Promise<Map<string, CachedProfile>> {
  const result = new Map<string, CachedProfile>();
  const now = Date.now();
  const misses: string[] = [];

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  for (const id of uniqueIds) {
    const entry = cache.get(id);
    if (entry && now - entry.fetchedAt < TTL_MS) {
      if (entry.profile) result.set(id, entry.profile);
    } else {
      misses.push(id);
    }
  }

  if (misses.length === 0) return result;

  const fetched = await Promise.all(misses.map(requestOne));
  for (let i = 0; i < misses.length; i++) {
    const profile = fetched[i];
    if (profile) result.set(misses[i], profile);
  }
  return result;
}

/** Invalidate one id (e.g., after a profile edit) so the next read refetches. */
export function invalidateProfileCache(id?: string) {
  if (!id) {
    cache.clear();
    return;
  }
  cache.delete(id);
}
