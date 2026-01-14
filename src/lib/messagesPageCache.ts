// Cache for messages page list data - enables instant loading for returning users

const CACHE_KEY = 'messages-page-cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedTeam {
  id: string;
  name: string;
  logo_url: string | null;
  clubs: { name: string; logo_url: string | null; sport: string | null };
}

interface CachedClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

interface CachedGroup {
  id: string;
  name: string;
  allowed_roles: string[];
  team_id: string | null;
  club_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  teams?: { name: string } | null;
  clubs?: { name: string } | null;
}

interface LatestMessage {
  text: string;
  author: string;
  created_at: string;
  image_url?: string | null;
}

interface MessagesPageCache {
  userId: string;
  timestamp: number;
  teams: CachedTeam[];
  memberClubs: CachedClub[];
  adminClubs: CachedClub[];
  chatGroups: CachedGroup[];
  latestBroadcast: { text: string; created_at: string; image_url: string | null; profiles: { display_name: string } | null } | null;
  latestTeamMessages: Record<string, LatestMessage>;
  latestClubMessages: Record<string, LatestMessage>;
  latestGroupMessages: Record<string, LatestMessage>;
}

export function getCachedMessagesPageData(userId: string): Omit<MessagesPageCache, 'userId' | 'timestamp'> | null {
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') return null;
    
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const data: MessagesPageCache = JSON.parse(cached);
    
    // Check if cache belongs to current user
    if (data.userId !== userId) return null;
    
    // Check if cache is expired
    if (Date.now() - data.timestamp > CACHE_EXPIRY_MS) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {}
      return null;
    }
    
    return {
      teams: data.teams || [],
      memberClubs: data.memberClubs || [],
      adminClubs: data.adminClubs || [],
      chatGroups: data.chatGroups || [],
      latestBroadcast: data.latestBroadcast || null,
      latestTeamMessages: data.latestTeamMessages || {},
      latestClubMessages: data.latestClubMessages || {},
      latestGroupMessages: data.latestGroupMessages || {},
    };
  } catch {
    return null;
  }
}

export function cacheMessagesPageData(
  userId: string,
  data: {
    teams?: CachedTeam[];
    memberClubs?: CachedClub[];
    adminClubs?: CachedClub[];
    chatGroups?: CachedGroup[];
    latestBroadcast?: { text: string; created_at: string; image_url?: string | null; profiles?: { display_name: string } | null } | null;
    latestTeamMessages?: Record<string, LatestMessage>;
    latestClubMessages?: Record<string, LatestMessage>;
    latestGroupMessages?: Record<string, LatestMessage>;
  }
): void {
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') return;
    
    // Get existing cache or create new
    const existing = getCachedMessagesPageData(userId);
    
    const cacheData: MessagesPageCache = {
      userId,
      timestamp: Date.now(),
      teams: data.teams ?? existing?.teams ?? [],
      memberClubs: data.memberClubs ?? existing?.memberClubs ?? [],
      adminClubs: data.adminClubs ?? existing?.adminClubs ?? [],
      chatGroups: data.chatGroups ?? existing?.chatGroups ?? [],
      latestBroadcast: (data.latestBroadcast !== undefined ? data.latestBroadcast : (existing?.latestBroadcast ?? null)) as MessagesPageCache['latestBroadcast'],
      latestTeamMessages: data.latestTeamMessages ?? existing?.latestTeamMessages ?? {},
      latestClubMessages: data.latestClubMessages ?? existing?.latestClubMessages ?? {},
      latestGroupMessages: data.latestGroupMessages ?? existing?.latestGroupMessages ?? {},
    };
    
    const jsonData = JSON.stringify(cacheData);
    
    try {
      localStorage.setItem(CACHE_KEY, jsonData);
    } catch (quotaError) {
      // Quota exceeded - try to clear old caches and retry
      clearOldCaches();
      try {
        localStorage.setItem(CACHE_KEY, jsonData);
      } catch {
        // Still failing - just skip caching silently
      }
    }
  } catch (e) {
    // Handle any other errors silently - caching is not critical
    console.debug('Failed to cache messages page data:', e);
  }
}

// Clear old localStorage caches to free up space
function clearOldCaches(): void {
  try {
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ignite_message_cache_') || 
          key?.startsWith('ignite_photos_cache') ||
          key?.startsWith('ignite_folders_cache')) {
        keysToRemove.push(key);
      }
    }
    
    // Remove oldest caches first
    keysToRemove.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {}
    });
  } catch {
    // Ignore errors
  }
}

export function clearMessagesPageCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore errors
  }
}
