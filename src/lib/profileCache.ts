import { supabase } from "@/integrations/supabase/client";

export interface CachedProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  cached_at: number;
}

const CACHE_KEY = "ignite_profiles_cache";
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours - longer TTL for better offline support
const STALE_TTL = 1000 * 60 * 60 * 48; // 48 hours - use stale data if DB fails
const MAX_CACHE_SIZE = 500;

// In-memory cache for instant access (avoids localStorage parsing overhead)
const memoryCache = new Map<string, CachedProfile>();
let memoryCacheLoaded = false;

// Track pending background refreshes to avoid duplicate requests
const pendingRefreshes = new Set<string>();

// Load from localStorage into memory cache on first access
function ensureMemoryCacheLoaded() {
  if (memoryCacheLoaded) return;
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') {
      memoryCacheLoaded = true;
      return;
    }
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedProfile[];
      parsed.forEach(p => memoryCache.set(p.id, p));
    }
    memoryCacheLoaded = true;
  } catch {
    memoryCacheLoaded = true;
  }
}

// Get all cached profiles - uses memory cache for speed
function getCache(): Map<string, CachedProfile> {
  ensureMemoryCacheLoaded();
  return memoryCache;
}

// Save cache to localStorage (debounced + idle to keep main thread free).
// On Android WebView, sync JSON.stringify of 500 profiles inline blocks UI;
// schedule the write during idle time so it never lands on a render frame.
let saveTimeout: number | null = null;
let saveIdleHandle: number | null = null;
function flushSaveNow() {
  saveIdleHandle = null;
  try {
    const entries = Array.from(memoryCache.values());
    if (entries.length > MAX_CACHE_SIZE) {
      entries.sort((a, b) => b.cached_at - a.cached_at);
      const trimmed = entries.slice(0, MAX_CACHE_SIZE);
      memoryCache.clear();
      trimmed.forEach(p => memoryCache.set(p.id, p));
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(memoryCache.values())));
  } catch {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
  }
}
function saveCache(cache: Map<string, CachedProfile>) {
  // Update memory cache immediately
  cache.forEach((v, k) => memoryCache.set(k, v));

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    saveTimeout = null;
    const ric = (typeof window !== 'undefined' && (window as any).requestIdleCallback) as
      | undefined
      | ((cb: () => void, opts?: { timeout: number }) => number);
    if (ric) {
      saveIdleHandle = ric(flushSaveNow, { timeout: 3000 });
    } else {
      setTimeout(flushSaveNow, 0);
    }
  }, 1000);
}

// Check if a cached profile is still valid (fresh)
function isCacheValid(profile: CachedProfile): boolean {
  return Date.now() - profile.cached_at < CACHE_TTL;
}

// Check if a cached profile is still usable (stale but acceptable)
function isCacheUsable(profile: CachedProfile): boolean {
  return Date.now() - profile.cached_at < STALE_TTL;
}

// Get profiles from cache, returns cached profiles and IDs that need fetching
export function getProfilesFromCache(ids: string[]): {
  cached: Map<string, CachedProfile>;
  missing: string[];
  stale: string[];
} {
  const cache = getCache();
  const cached = new Map<string, CachedProfile>();
  const missing: string[] = [];
  const stale: string[] = [];

  for (const id of ids) {
    const profile = cache.get(id);
    if (profile) {
      if (isCacheValid(profile)) {
        cached.set(id, profile);
      } else if (isCacheUsable(profile)) {
        // Stale but usable - return it but mark for refresh
        cached.set(id, profile);
        stale.push(id);
      } else {
        missing.push(id);
      }
    } else {
      missing.push(id);
    }
  }

  return { cached, missing, stale };
}

// Cache profiles after fetching
export function cacheProfiles(profiles: Array<{ id: string; display_name: string | null; avatar_url: string | null }>) {
  const cache = getCache();
  const now = Date.now();
  
  for (const profile of profiles) {
    cache.set(profile.id, {
      id: profile.id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      cached_at: now,
    });
  }
  
  saveCache(cache);
}

// Event emitter for cache updates - allows hooks to react to changes
const cacheUpdateListeners = new Set<(id: string) => void>();

export function onProfileCacheUpdate(listener: (id: string) => void): () => void {
  cacheUpdateListeners.add(listener);
  return () => cacheUpdateListeners.delete(listener);
}

// Update a single profile in cache (e.g., after edit)
export function updateProfileCache(profile: { id: string; display_name: string | null; avatar_url: string | null }) {
  const cache = getCache();
  cache.set(profile.id, {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    cached_at: Date.now(),
  });
  saveCache(cache);
  // Notify listeners so hooks re-render with updated data
  cacheUpdateListeners.forEach(fn => fn(profile.id));
}

// Clear the profile cache
export function clearProfileCache() {
  memoryCache.clear();
  memoryCacheLoaded = false;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

// Background refresh - doesn't block, just updates cache silently
async function backgroundRefresh(ids: string[]) {
  const idsToRefresh = ids.filter(id => !pendingRefreshes.has(id));
  if (idsToRefresh.length === 0) return;
  
  idsToRefresh.forEach(id => pendingRefreshes.add(id));
  
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", idsToRefresh);
    
    if (data) {
      cacheProfiles(data);
    }
  } catch (error) {
    // Silent fail for background refresh
    console.debug("Background profile refresh failed:", error);
  } finally {
    idsToRefresh.forEach(id => pendingRefreshes.delete(id));
  }
}

// Fetch profiles with caching - returns cached data immediately, fetches missing in background
// AGGRESSIVE: Prioritizes returning cached/stale data over waiting for DB
export async function fetchProfilesWithCache(
  ids: string[],
  options: { allowStale?: boolean; timeout?: number } = {}
): Promise<Map<string, CachedProfile>> {
  const { allowStale = true, timeout = 15000 } = options; // 15 second default timeout
  
  if (ids.length === 0) return new Map();
  
  const uniqueIds = [...new Set(ids)];
  const { cached, missing, stale } = getProfilesFromCache(uniqueIds);
  
  // Trigger background refresh for stale profiles
  if (stale.length > 0) {
    backgroundRefresh(stale);
  }
  
  // If all profiles are cached (or stale but usable), return immediately
  if (missing.length === 0) {
    return cached;
  }
  
  // Fetch missing profiles with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", missing)
      .abortSignal(controller.signal);
    
    clearTimeout(timeoutId);
    
    if (error) throw error;
    
    if (data) {
      cacheProfiles(data);
      for (const profile of data) {
        cached.set(profile.id, {
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          cached_at: Date.now(),
        });
      }
    }
  } catch (error: any) {
    // If fetch fails, return whatever we have from cache
    console.warn("Profile fetch failed, using cached data:", error?.message || error);
    
    // For missing IDs, check if we have any stale data we can use
    if (allowStale) {
      const cache = getCache();
      for (const id of missing) {
        const profile = cache.get(id);
        if (profile) {
          cached.set(id, profile);
        }
      }
    }
  }
  
  return cached;
}

// Get a single profile from cache (synchronous)
export function getProfileFromCache(id: string): CachedProfile | null {
  const cache = getCache();
  const profile = cache.get(id);
  // Return stale data if available
  return profile && isCacheUsable(profile) ? profile : null;
}

// Fetch a single profile with caching
export async function fetchSingleProfileWithCache(
  id: string
): Promise<{ display_name: string | null; avatar_url: string | null } | null> {
  const profiles = await fetchProfilesWithCache([id]);
  const profile = profiles.get(id);
  return profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null;
}
