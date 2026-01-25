import { useState, useEffect, useCallback } from "react";
import { 
  fetchProfilesWithCache, 
  getProfilesFromCache, 
  CachedProfile,
  cacheProfiles 
} from "@/lib/profileCache";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to fetch and cache multiple profiles efficiently
 * Returns cached profiles immediately, then updates with fresh data
 * AGGRESSIVE CACHING: Prioritizes cached/stale data to avoid blocking on DB
 */
export function useProfiles(ids: string[]) {
  const [profiles, setProfiles] = useState<Map<string, CachedProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setProfiles(new Map());
      return;
    }

    const uniqueIds = [...new Set(ids.filter(Boolean))];
    
    // Immediately set cached profiles (including stale ones)
    const { cached, missing, stale } = getProfilesFromCache(uniqueIds);
    if (cached.size > 0) {
      setProfiles(cached);
    }
    
    // Only set loading if we have missing profiles (not just stale)
    if (missing.length > 0) {
      setIsLoading(true);
      fetchProfilesWithCache(uniqueIds, { allowStale: true, timeout: 15000 })
        .then(allProfiles => {
          setProfiles(allProfiles);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (stale.length > 0) {
      // Stale profiles exist - refresh in background without loading state
      fetchProfilesWithCache(uniqueIds, { allowStale: true, timeout: 15000 })
        .then(allProfiles => {
          setProfiles(allProfiles);
        });
    }
  }, [ids.join(",")]); // Join to create stable dependency

  const getProfile = useCallback((id: string) => {
    return profiles.get(id) || null;
  }, [profiles]);

  return { profiles, getProfile, isLoading };
}

/**
 * Fetch profiles and cache them - for use in async functions
 * Uses aggressive caching with stale data fallback
 */
export async function fetchAndCacheProfiles(ids: string[]): Promise<Map<string, CachedProfile>> {
  return fetchProfilesWithCache(ids, { allowStale: true, timeout: 15000 });
}

/**
 * Prefetch profiles for a list of user IDs (fire and forget)
 * Silent background fetch that doesn't block
 */
export function prefetchProfiles(ids: string[]) {
  if (ids.length === 0) return;
  
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const { missing } = getProfilesFromCache(uniqueIds);
  
  if (missing.length > 0) {
    // Use a moderate timeout for prefetch - wrapped in async IIFE for proper error handling
    (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", missing)
          .abortSignal(controller.signal);
        
        clearTimeout(timeoutId);
        if (data) {
          cacheProfiles(data);
        }
      } catch {
        clearTimeout(timeoutId);
        // Silent fail for prefetch
      }
    })();
  }
}
