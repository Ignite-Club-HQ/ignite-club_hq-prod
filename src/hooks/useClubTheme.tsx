import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";

interface HSLColor {
  h: number;
  s: number;
  l: number;
}

interface ClubTheme {
  clubId: string;
  clubName: string;
  logoUrl: string | null;
  showLogoInHeader: boolean;
  showNameInHeader: boolean;
  logoOnlyMode: boolean;
  sport: string | null;
  // Light mode colors
  primary: HSLColor | null;
  secondary: HSLColor | null;
  accent: HSLColor | null;
  // Dark mode colors
  darkPrimary: HSLColor | null;
  darkSecondary: HSLColor | null;
  darkAccent: HSLColor | null;
}

// Cache structure - includes logoUrl for instant header display
interface CachedThemeData {
  clubId: string;
  clubName: string;
  logoUrl: string | null;
  showLogoInHeader: boolean;
  showNameInHeader: boolean;
  logoOnlyMode: boolean;
  sport: string | null;
  primary: HSLColor | null;
  secondary: HSLColor | null;
  accent: HSLColor | null;
  darkPrimary: HSLColor | null;
  darkSecondary: HSLColor | null;
  darkAccent: HSLColor | null;
}

// Helper to convert full theme to cacheable version (includes logoUrl for instant display)
const toCacheableTheme = (theme: ClubTheme): CachedThemeData => ({
  clubId: theme.clubId,
  clubName: theme.clubName,
  logoUrl: theme.logoUrl,
  showLogoInHeader: theme.showLogoInHeader,
  showNameInHeader: theme.showNameInHeader,
  logoOnlyMode: theme.logoOnlyMode,
  sport: theme.sport,
  primary: theme.primary,
  secondary: theme.secondary,
  accent: theme.accent,
  darkPrimary: theme.darkPrimary,
  darkSecondary: theme.darkSecondary,
  darkAccent: theme.darkAccent,
});

// Safe localStorage setter that handles quota errors
const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Quota exceeded - try to clear old theme data first
    console.warn('localStorage quota exceeded, clearing old theme data');
    try {
      // Clear all theme data keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(STORAGE_KEY_PREFIX) || k.startsWith(STORAGE_DATA_KEY_PREFIX))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // Retry
      localStorage.setItem(key, value);
    } catch {
      // Still failed - just skip caching
      console.warn('Failed to cache theme data');
    }
  }
};

interface ClubThemeContextType {
  availableClubThemes: ClubTheme[];
  activeClubTheme: string | null; // club ID or null - also acts as content filter
  activeThemeData: ClubTheme | null;
  setActiveClubTheme: (clubId: string | null) => void;
  isLoading: boolean;
  isThemeReady: boolean; // True when theme loading from DB is complete
  // Club filter helpers - when a theme is active, content is filtered to that club
  activeClubFilter: string | null; // Same as activeClubTheme - for semantic clarity
  activeClubTeamIds: string[]; // Team IDs belonging to the active club (for filtering)
}

const ClubThemeContext = createContext<ClubThemeContextType>({
  availableClubThemes: [],
  activeClubTheme: null,
  activeThemeData: null,
  setActiveClubTheme: () => {},
  isLoading: false,
  isThemeReady: false,
  activeClubFilter: null,
  activeClubTeamIds: [],
});

const STORAGE_KEY_PREFIX = "ignite-club-theme-";
const STORAGE_DATA_KEY_PREFIX = "ignite-club-theme-data-";

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}${userId}`;
const getStorageDataKey = (userId: string) => `${STORAGE_DATA_KEY_PREFIX}${userId}`;

// Apply theme CSS from theme data based on current mode
const applyThemeCSS = (theme: ClubTheme | null, isDarkMode: boolean) => {
  const root = document.documentElement;
  
  if (!theme || theme.logoOnlyMode) {
    // Don't apply theme colors in logo-only mode
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--secondary");
    root.style.removeProperty("--secondary-foreground");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-foreground");
    root.style.removeProperty("--ring");
    return;
  }

  // Choose colors based on mode - fall back to light colors if dark not set
  const primary = isDarkMode ? (theme.darkPrimary || theme.primary) : theme.primary;
  const secondary = isDarkMode ? (theme.darkSecondary || theme.secondary) : theme.secondary;
  const accent = isDarkMode ? (theme.darkAccent || theme.accent) : theme.accent;

  if (primary) {
    root.style.setProperty("--primary", `${primary.h} ${primary.s}% ${primary.l}%`);
    const fgL = primary.l > 50 ? 10 : 98;
    root.style.setProperty("--primary-foreground", `${primary.h} 10% ${fgL}%`);
    root.style.setProperty("--ring", `${primary.h} ${primary.s}% ${primary.l}%`);
  }

  if (secondary) {
    root.style.setProperty("--secondary", `${secondary.h} ${secondary.s}% ${secondary.l}%`);
    const fgL = secondary.l > 50 ? 20 : 90;
    root.style.setProperty("--secondary-foreground", `${secondary.h} 40% ${fgL}%`);
  }

  if (accent) {
    root.style.setProperty("--accent", `${accent.h} ${accent.s}% ${accent.l}%`);
    const fgL = accent.l > 50 ? 30 : 60;
    root.style.setProperty("--accent-foreground", `${accent.h} 84% ${fgL}%`);
  }
};

export function ClubThemeProvider({ children }: { children: ReactNode }) {
  // Safely access auth context - may not be available during HMR or initial render
  let user = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch (e) {
    // AuthProvider not yet available (HMR or render order issue)
    console.warn('[ClubThemeProvider] AuthProvider not available yet');
  }
  
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [activeClubTheme, setActiveClubThemeState] = useState<string | null>(null);
  const [cachedThemeData, setCachedThemeData] = useState<ClubTheme | null>(null);

  // Track if we've checked for default theme for this user session
  const [hasCheckedDefault, setHasCheckedDefault] = useState(false);
  // Track if we're loading theme from database
  const [isLoadingFromDb, setIsLoadingFromDb] = useState(false);
  // Track if we've ever started the DB load for this user session
  const [hasStartedDbLoad, setHasStartedDbLoad] = useState(false);

  // Ensure loading state is set when user becomes available (before effect runs)
  useEffect(() => {
    if (user?.id && !hasStartedDbLoad) {
      setIsLoadingFromDb(true);
      setHasStartedDbLoad(true);
    }
    // Reset when user logs out
    if (!user?.id && hasStartedDbLoad) {
      setHasStartedDbLoad(false);
    }
  }, [user?.id, hasStartedDbLoad]);

  // INSTANT THEME APPLICATION: Restore from localStorage immediately on mount
  // Then load from database for cross-device sync
  useEffect(() => {
    if (user?.id && typeof window !== "undefined") {
      const storedId = localStorage.getItem(getStorageKey(user.id));
      const storedData = localStorage.getItem(getStorageDataKey(user.id));
      
      if (storedId) {
        setActiveClubThemeState(storedId);
        
        // Apply cached theme data INSTANTLY before fetch completes
        if (storedData) {
          try {
            const parsedData = JSON.parse(storedData) as CachedThemeData;
            // Create full theme from cache including logoUrl for instant display
            const themeFromCache: ClubTheme = { 
              ...parsedData, 
              logoUrl: parsedData.logoUrl ?? null, 
              sport: parsedData.sport ?? null 
            };
            setCachedThemeData(themeFromCache);
            applyThemeCSS(themeFromCache, isDarkMode);
          } catch {
            // Invalid cache, will be refreshed from server
          }
        }
      }
      
      // Load theme preference from database (cross-device sync)
      const loadThemeFromDb = async () => {
        setIsLoadingFromDb(true);
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('active_club_theme_id')
            .eq('id', user.id)
            .single();
          
          if (!error && data) {
            // We successfully fetched profile data
            if (data.active_club_theme_id) {
              // Database has a club theme preference - use it (overrides localStorage for cross-device sync)
              setActiveClubThemeState(data.active_club_theme_id);
              safeSetItem(getStorageKey(user.id), data.active_club_theme_id);
              // User has explicit preference - don't auto-set
              setHasCheckedDefault(true);
              
              // CRITICAL FIX: Always try to fetch and apply theme data when DB has a preference
              // This ensures theme applies immediately for:
              // 1. Cross-device sync (no localStorage data)
              // 2. First login after invite (localStorage just set but might not be applied yet)
              // Check if we have FRESH localStorage data that matches the DB preference
              const freshStoredData = localStorage.getItem(getStorageDataKey(user.id));
              let themeApplied = false;
              
              if (freshStoredData) {
                try {
                  const parsedData = JSON.parse(freshStoredData) as CachedThemeData;
                  // Only use cached data if it matches the club ID from database
                  if (parsedData.clubId === data.active_club_theme_id) {
                    const themeFromCache: ClubTheme = { 
                      ...parsedData, 
                      logoUrl: parsedData.logoUrl ?? null, 
                      sport: parsedData.sport ?? null 
                    };
                    setCachedThemeData(themeFromCache);
                    applyThemeCSS(themeFromCache, isDarkMode);
                    themeApplied = true;
                  }
                } catch {
                  // Invalid cache, will fetch from server
                }
              }
              
              // If no valid cache or cache didn't match, fetch from server
              if (!themeApplied) {
                const { data: clubData } = await supabase
                  .from('clubs')
                  .select(`
                    id, name, logo_url, show_logo_in_header, show_name_in_header, logo_only_mode, sport,
                    theme_primary_h, theme_primary_s, theme_primary_l,
                    theme_dark_primary_h, theme_dark_primary_s, theme_dark_primary_l,
                    theme_secondary_h, theme_secondary_s, theme_secondary_l,
                    theme_dark_secondary_h, theme_dark_secondary_s, theme_dark_secondary_l,
                    theme_accent_h, theme_accent_s, theme_accent_l,
                    theme_dark_accent_h, theme_dark_accent_s, theme_dark_accent_l
                  `)
                  .eq('id', data.active_club_theme_id)
                  .single();
                
                if (clubData) {
                  const themeData: ClubTheme = {
                    clubId: clubData.id,
                    clubName: clubData.name,
                    logoUrl: clubData.logo_url,
                    showLogoInHeader: clubData.show_logo_in_header ?? false,
                    showNameInHeader: clubData.show_name_in_header ?? true,
                    logoOnlyMode: clubData.logo_only_mode ?? false,
                    sport: clubData.sport,
                    primary: clubData.theme_primary_h !== null ? { h: clubData.theme_primary_h, s: clubData.theme_primary_s!, l: clubData.theme_primary_l! } : null,
                    secondary: clubData.theme_secondary_h !== null ? { h: clubData.theme_secondary_h, s: clubData.theme_secondary_s!, l: clubData.theme_secondary_l! } : null,
                    accent: clubData.theme_accent_h !== null ? { h: clubData.theme_accent_h, s: clubData.theme_accent_s!, l: clubData.theme_accent_l! } : null,
                    darkPrimary: clubData.theme_dark_primary_h !== null ? { h: clubData.theme_dark_primary_h, s: clubData.theme_dark_primary_s!, l: clubData.theme_dark_primary_l! } : null,
                    darkSecondary: clubData.theme_dark_secondary_h !== null ? { h: clubData.theme_dark_secondary_h, s: clubData.theme_dark_secondary_s!, l: clubData.theme_dark_secondary_l! } : null,
                    darkAccent: clubData.theme_dark_accent_h !== null ? { h: clubData.theme_dark_accent_h, s: clubData.theme_dark_accent_s!, l: clubData.theme_dark_accent_l! } : null,
                  };
                  safeSetItem(getStorageDataKey(user.id), JSON.stringify(toCacheableTheme(themeData)));
                  setCachedThemeData(themeData);
                  applyThemeCSS(themeData, isDarkMode);
                }
              }
            }
            // If active_club_theme_id is null, it could mean:
            // 1. User explicitly chose default (but we can't distinguish this easily)
            // 2. New user who hasn't set any preference yet
            // We'll let the auto-set logic handle new users by NOT setting hasCheckedDefault here
            // The auto-set will run if availableClubThemes has items
          } else if (storedId) {
            // Have localStorage but failed to fetch DB - use localStorage, don't auto-set
            setHasCheckedDefault(true);
          }
          // If no data and no storedId, hasCheckedDefault stays false and auto-set may occur
        } catch (err) {
          console.error('Failed to load club theme from database:', err);
        } finally {
          setIsLoadingFromDb(false);
        }
      };
      
      loadThemeFromDb();
    }
  }, [user?.id, isDarkMode]);


  // Clear theme CSS on logout (but keep localStorage preference for re-login)
  useEffect(() => {
    if (!user) {
      setActiveClubThemeState(null);
      // Clear CSS variables but DON'T remove localStorage - restore on re-login
      const root = document.documentElement;
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--secondary");
      root.style.removeProperty("--secondary-foreground");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
      root.style.removeProperty("--ring");
    }
  }, [user]);

  // Fetch all Pro clubs that the user belongs to with custom themes
  const { data: availableClubThemes = [], isLoading } = useQuery({
    queryKey: ["club-themes", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get user's clubs through their roles
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);

      if (rolesError || !userRoles?.length) return [];

      const clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))];

      // Also get clubs from teams
      const { data: teamRoles } = await supabase
        .from("user_roles")
        .select("team_id, teams!inner(club_id)")
        .eq("user_id", user.id)
        .not("team_id", "is", null);

      if (teamRoles) {
        teamRoles.forEach(r => {
          const teamClubId = (r.teams as any)?.club_id;
          if (teamClubId && !clubIds.includes(teamClubId)) {
            clubIds.push(teamClubId);
          }
        });
      }

      if (!clubIds.length) return [];

      // Fetch clubs with theme settings (left join on subscriptions)
      const { data: clubs, error: clubsError } = await supabase
        .from("clubs")
        .select(`
          id,
          name,
          logo_url,
          show_logo_in_header,
          show_name_in_header,
          logo_only_mode,
          sport,
          is_pro,
          theme_enabled,
          theme_primary_h,
          theme_primary_s,
          theme_primary_l,
          theme_secondary_h,
          theme_secondary_s,
          theme_secondary_l,
          theme_accent_h,
          theme_accent_s,
          theme_accent_l,
          theme_dark_primary_h,
          theme_dark_primary_s,
          theme_dark_primary_l,
          theme_dark_secondary_h,
          theme_dark_secondary_s,
          theme_dark_secondary_l,
          theme_dark_accent_h,
          theme_dark_accent_s,
          theme_dark_accent_l,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds);

      if (clubsError || !clubs) return [];

      // Filter to only Pro clubs with theme data that have theme enabled
      return clubs
        .filter(club => {
          // Handle both array and single object subscription data
          const subs = club.club_subscriptions as any;
          const sub = Array.isArray(subs) && subs.length > 0 ? subs[0] : 
                     (subs && !Array.isArray(subs) ? subs : null);
          const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) && 
            (!sub.expires_at || new Date(sub.expires_at) > new Date());
          // Check club.is_pro flag directly (synced by trigger)
          const hasPro = club.is_pro === true || hasProFromSub === true;
          const hasTheme = club.theme_primary_h !== null;
          const themeEnabled = (club as any).theme_enabled !== false; // Default to true
          return hasPro && hasTheme && themeEnabled;
        })
        .map(club => ({
          clubId: club.id,
          clubName: club.name,
          logoUrl: club.logo_url,
          showLogoInHeader: club.show_logo_in_header ?? false,
          showNameInHeader: club.show_name_in_header ?? true,
          logoOnlyMode: club.logo_only_mode ?? false,
          sport: club.sport,
          primary: club.theme_primary_h !== null ? {
            h: club.theme_primary_h!,
            s: club.theme_primary_s!,
            l: club.theme_primary_l!,
          } : null,
          secondary: club.theme_secondary_h !== null ? {
            h: club.theme_secondary_h!,
            s: club.theme_secondary_s!,
            l: club.theme_secondary_l!,
          } : null,
          accent: club.theme_accent_h !== null ? {
            h: club.theme_accent_h!,
            s: club.theme_accent_s!,
            l: club.theme_accent_l!,
          } : null,
          darkPrimary: club.theme_dark_primary_h !== null ? {
            h: club.theme_dark_primary_h!,
            s: club.theme_dark_primary_s!,
            l: club.theme_dark_primary_l!,
          } : null,
          darkSecondary: club.theme_dark_secondary_h !== null ? {
            h: club.theme_dark_secondary_h!,
            s: club.theme_dark_secondary_s!,
            l: club.theme_dark_secondary_l!,
          } : null,
          darkAccent: club.theme_dark_accent_h !== null ? {
            h: club.theme_dark_accent_h!,
            s: club.theme_dark_accent_s!,
            l: club.theme_dark_accent_l!,
          } : null,
        }));
    },
    enabled: !!user?.id,
  });

  // Auto-set theme for new members who haven't set a preference yet
  useEffect(() => {
    if (!user?.id || hasCheckedDefault || isLoading || isLoadingFromDb) return;
    
    // Check if user has any stored preference (including explicit "none")
    const hasStoredPreference = localStorage.getItem(getStorageKey(user.id)) !== null;
    
    if (!hasStoredPreference && availableClubThemes.length > 0) {
      // New member - default to first available club theme
      const firstTheme = availableClubThemes[0];
      setActiveClubThemeState(firstTheme.clubId);
      safeSetItem(getStorageKey(user.id), firstTheme.clubId);
      safeSetItem(getStorageDataKey(user.id), JSON.stringify(toCacheableTheme(firstTheme)));
      setCachedThemeData(firstTheme);
      applyThemeCSS(firstTheme, isDarkMode);
      
      // Also save to database for cross-device sync
      supabase
        .from('profiles')
        .update({ active_club_theme_id: firstTheme.clubId })
        .eq('id', user.id)
        .then(() => console.log('Auto-set club theme saved to profile'));
    }
    
    setHasCheckedDefault(true);
  }, [user?.id, availableClubThemes, isLoading, isLoadingFromDb, hasCheckedDefault, isDarkMode]);

  const setActiveClubTheme = (clubId: string | null) => {
    setActiveClubThemeState(clubId);
    if (user?.id) {
      const key = getStorageKey(user.id);
      const dataKey = getStorageDataKey(user.id);
      if (clubId) {
        safeSetItem(key, clubId);
        // Also cache the theme data for instant loading
        const themeData = availableClubThemes.find(t => t.clubId === clubId);
        if (themeData) {
          safeSetItem(dataKey, JSON.stringify(toCacheableTheme(themeData)));
          setCachedThemeData(themeData);
        }
      } else {
        localStorage.removeItem(key);
        localStorage.removeItem(dataKey);
        setCachedThemeData(null);
      }
      
      // Save preference to database for cross-device sync
      supabase
        .from('profiles')
        .update({ active_club_theme_id: clubId })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) console.error('Failed to save club theme preference:', error);
        });
    }
  };

  // Apply theme CSS variables - only when user is logged in
  // Re-apply when dark/light mode changes
  useEffect(() => {
    const root = document.documentElement;

    // Don't apply theme if not logged in
    if (!user) {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--secondary");
      root.style.removeProperty("--secondary-foreground");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
      root.style.removeProperty("--ring");
      return;
    }

    if (!activeClubTheme) {
      // Remove club theme overrides
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--secondary");
      root.style.removeProperty("--secondary-foreground");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
      root.style.removeProperty("--ring");
      return;
    }

    // Try to find theme from server data first
    const theme = availableClubThemes.find(t => t.clubId === activeClubTheme);
    
    // CRITICAL FIX: If server data not loaded yet, use cached theme data
    // This ensures theme applies immediately for new users before query completes
    const themeToApply = theme || cachedThemeData;
    
    if (!themeToApply) {
      // No theme data available yet - will be applied when data loads
      return;
    }

    // Skip applying colors if logo-only mode is enabled
    if (themeToApply.logoOnlyMode) {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--secondary");
      root.style.removeProperty("--secondary-foreground");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
      root.style.removeProperty("--ring");
      return;
    }

    applyThemeCSS(themeToApply, isDarkMode);
  }, [activeClubTheme, availableClubThemes, cachedThemeData, user, isDarkMode]);

  // Validate stored theme exists and user is a member
  useEffect(() => {
    if (activeClubTheme && availableClubThemes.length > 0) {
      const exists = availableClubThemes.some(t => t.clubId === activeClubTheme);
      if (!exists) {
        setActiveClubTheme(null);
      }
    }
  }, [activeClubTheme, availableClubThemes]);

  // Cache theme data when server data becomes available
  useEffect(() => {
    if (user?.id && activeClubTheme && availableClubThemes.length > 0) {
      const serverTheme = availableClubThemes.find(t => t.clubId === activeClubTheme);
      if (serverTheme) {
        safeSetItem(getStorageDataKey(user.id), JSON.stringify(toCacheableTheme(serverTheme)));
        setCachedThemeData(serverTheme);
      }
    }
  }, [user?.id, activeClubTheme, availableClubThemes]);

  // Use server data if available, otherwise fall back to cached data
  const activeThemeData = activeClubTheme 
    ? availableClubThemes.find(t => t.clubId === activeClubTheme) || cachedThemeData
    : null;

  // Fetch teams belonging to the active club (for content filtering)
  const { data: activeClubTeamIds = [] } = useQuery({
    queryKey: ["active-club-teams", activeClubTheme],
    queryFn: async () => {
      if (!activeClubTheme) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", activeClubTheme);
      if (error) return [];
      return data.map(t => t.id);
    },
    enabled: !!activeClubTheme,
    staleTime: 300000, // Cache for 5 minutes
  });

  // Theme is ready when:
  // - No user (anonymous/logged out) - no theme to load
  // - OR user exists AND we've started AND finished loading from DB
  // This prevents flash of default theme on first login
  const themeIsReady = !user?.id || (hasStartedDbLoad && !isLoadingFromDb);

  return (
    <ClubThemeContext.Provider value={{
      availableClubThemes,
      activeClubTheme,
      activeThemeData,
      setActiveClubTheme,
      isLoading,
      isThemeReady: themeIsReady,
      activeClubFilter: activeClubTheme,
      activeClubTeamIds,
    }}>
      {children}
    </ClubThemeContext.Provider>
  );
}

export function useClubTheme() {
  return useContext(ClubThemeContext);
}

/**
 * Synchronously check localStorage for cached club theme data.
 * Use this for initial render to prevent gradient flash before React hydrates.
 * Returns true if user has an active club theme cached.
 */
export function hasClubThemeCached(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Check for any cached theme data - means user has club theme active
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_DATA_KEY_PREFIX)) {
        const data = localStorage.getItem(key);
        if (data) return true;
      }
    }
  } catch {
    // localStorage not available
  }
  return false;
}
