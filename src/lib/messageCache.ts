// Local message cache for offline reading

export interface CachedMessage {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  image_url: string | null;
  reply_to_id: string | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  reactions?: Array<{ reaction_type: string; user_id: string; id?: string }>;
  reply_to?: {
    id?: string;
    text: string;
    author_id?: string;
    profiles?: { display_name: string | null } | null;
    author?: { display_name: string | null } | null;
  } | null;
  // Allow extra properties for different chat types
  [key: string]: unknown;
}

interface CacheEntry {
  messages: CachedMessage[];
  timestamp: number;
}

const CACHE_KEY_PREFIX = "ignite_message_cache_";
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHED_MESSAGES = 100; // Per chat

function getCacheKey(type: "team" | "club" | "group" | "broadcast", targetId: string): string {
  return `${CACHE_KEY_PREFIX}${type}_${targetId}`;
}

// Get cached messages for a specific chat
export function getCachedMessages(type: "team" | "club" | "group" | "broadcast", targetId: string): CachedMessage[] {
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') return [];
    
    const key = getCacheKey(type, targetId);
    const stored = localStorage.getItem(key);
    if (!stored) return [];

    const entry: CacheEntry = JSON.parse(stored);
    
    // Check if cache is expired
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      try {
        localStorage.removeItem(key);
      } catch {}
      return [];
    }

    return entry.messages;
  } catch {
    return [];
  }
}

// Save messages to cache
export function cacheMessages(
  type: "team" | "club" | "group" | "broadcast",
  targetId: string,
  messages: CachedMessage[]
): void {
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') return;
    
    const key = getCacheKey(type, targetId);
    
    // Only cache the most recent messages
    const messagesToCache = messages.slice(0, MAX_CACHED_MESSAGES);
    
    const entry: CacheEntry = {
      messages: messagesToCache,
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(key, JSON.stringify(entry));
    } catch (quotaError) {
      // localStorage might be full - try to clear old caches
      clearOldCaches();
      try {
        localStorage.setItem(key, JSON.stringify(entry));
      } catch {
        // Still failing - skip silently
      }
    }
  } catch {
    // Ignore errors - caching is not critical
  }
}

// Add a single message to cache (for optimistic updates)
export function addMessageToCache(
  type: "team" | "club" | "group" | "broadcast",
  targetId: string,
  message: CachedMessage
): void {
  try {
    const existing = getCachedMessages(type, targetId);
    
    // Add to beginning (newest first)
    const updated = [message, ...existing.filter(m => m.id !== message.id)];
    
    cacheMessages(type, targetId, updated);
  } catch {
    console.error("Failed to add message to cache");
  }
}

// Clear old caches to free up space
function clearOldCaches(): void {
  try {
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const entry: CacheEntry = JSON.parse(stored);
            if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore errors
  }
}

// Check if we have cached messages for a chat
export function hasCachedMessages(type: "team" | "club" | "group" | "broadcast", targetId: string): boolean {
  return getCachedMessages(type, targetId).length > 0;
}

// Check if messages unexpectedly dropped to 0 (had cache but now empty)
// Returns true if a refetch should be triggered
export function shouldRefetchMessages(
  type: "team" | "club" | "group" | "broadcast",
  targetId: string,
  fetchedCount: number
): boolean {
  if (fetchedCount > 0) return false;
  
  // If we fetched 0 messages but have cached messages, something is wrong
  const cachedCount = getCachedMessages(type, targetId).length;
  return cachedCount > 0;
}

// Clear cache for a specific chat
export function clearMessageCache(type: "team" | "club" | "group" | "broadcast", targetId: string): void {
  try {
    const key = getCacheKey(type, targetId);
    localStorage.removeItem(key);
  } catch {
    // Ignore errors
  }
}
