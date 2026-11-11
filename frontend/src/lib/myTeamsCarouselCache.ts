import { writeBoundedReadCache } from "./deviceCacheBudget";
// Lightweight localStorage hydration for the home page "My Teams" carousel.
// Keyed by user + active club filter so each context restores its own snapshot.
// Cold opens render real cards instantly; React Query revalidates in background.

const PREFIX = "ignite_my_teams_carousel_v2_";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — stale entries are still useful as a placeholder

interface Entry<T> {
  data: T;
  timestamp: number;
}

function key(userId: string, activeClubFilter: string | null): string {
  return `${PREFIX}${userId}_${activeClubFilter || "all"}`;
}

export function getCachedCarousel<T>(userId: string | undefined, activeClubFilter: string | null): T | null {
  if (!userId) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key(userId, activeClubFilter));
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > TTL_MS) {
      try { localStorage.removeItem(key(userId, activeClubFilter)); } catch { /* ignore storage cleanup errors */ }
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedCarousel<T>(userId: string | undefined, activeClubFilter: string | null, data: T): void {
  if (!userId) return;
  try {
    if (typeof localStorage === "undefined") return;
    const entry: Entry<T> = { data, timestamp: Date.now() };
    if (writeBoundedReadCache(key(userId, activeClubFilter), JSON.stringify(entry))) return;
    // Too large: keep the cards, drop embedded image bytes and session-only
    // links (they reload on screen). A slim save beats no save, which made
    // every open wait for a full reload.
    const slim = JSON.stringify(entry, (_k, value) =>
      typeof value === "string" && (value.startsWith("blob:") || (value.startsWith("data:") && value.length > 2048)) ? undefined : value);
    writeBoundedReadCache(key(userId, activeClubFilter), slim);
  } catch {
    // quota or unavailable — ignore
  }
}

/**
 * Variant that returns both the cached payload and its write timestamp so
 * callers can hand the timestamp to React Query as `initialDataUpdatedAt`.
 * That lets RQ report `isLoading=false` immediately for warm-cache mounts,
 * letting downstream readiness gates flip without waiting for the network.
 */
export function getCachedCarouselWithTs<T>(
  userId: string | undefined,
  activeClubFilter: string | null,
  options: { allowStale?: boolean } = {},
): { data: T; timestamp: number } | null {
  if (!userId) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key(userId, activeClubFilter));
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (!options.allowStale && Date.now() - entry.timestamp > TTL_MS) {
      try { localStorage.removeItem(key(userId, activeClubFilter)); } catch { /* ignore storage cleanup errors */ }
      return null;
    }
    return { data: entry.data, timestamp: entry.timestamp };
  } catch {
    return null;
  }
}

