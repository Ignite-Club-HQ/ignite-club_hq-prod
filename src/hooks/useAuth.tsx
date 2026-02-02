import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { subscribeToPushNotifications } from "@/lib/pushNotifications";
import { prefetchUserData } from "@/lib/prefetchData";
import { clearProfileCache } from "@/lib/profileCache";
import { clearRolesCache } from "@/lib/rolesCache";
import { clearClubTeamCache } from "@/lib/clubTeamCache";
import { syncPasskeyAccountsFromDatabase } from "@/hooks/usePasskey";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import { markProfileCompleted } from "@/components/InviteFlowProgress";

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  ignite_points: number;
  has_sausage_reward: boolean;
  theme_preference: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  profileError: boolean;
  initialized: boolean; // True only after first auth check completes
  unreadCount: number;
  unreadMessagesCount: number;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  clearUnreadCount: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_CACHE_KEY = 'ignite_cached_profile';

interface CachedProfileData {
  profile: Profile;
  userId: string;
  cachedAt: number;
}

// Profile cache now includes userId to prevent cross-user cache collisions
function getCachedProfile(userId?: string): Profile | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as CachedProfileData;
      // CRITICAL: Only return cache if userId matches
      // This prevents stale cache from wrong user causing login issues
      if (userId && data.userId !== userId) {
        console.log('[Auth] Cached profile userId mismatch, clearing stale cache');
        localStorage.removeItem(PROFILE_CACHE_KEY);
        return null;
      }
      // Also validate cache structure has expected fields
      if (data.profile && data.profile.id) {
        return data.profile;
      }
      // Legacy format - clear it
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore parse errors, clear invalid cache
    localStorage.removeItem(PROFILE_CACHE_KEY);
  }
  return null;
}

// Get cached profile with its userId for validation
function getCachedProfileWithUser(): { profile: Profile; userId: string } | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as CachedProfileData;
      if (data.profile && data.profile.id && data.userId) {
        return { profile: data.profile, userId: data.userId };
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// SYNCHRONOUS initialization: Check if we have a valid cached profile with display_name
// This runs ONCE at module load time to determine initial state
function getInitialAuthState(): { 
  profile: Profile | null; 
  initialized: boolean; 
  loading: boolean; 
  profileLoading: boolean;
  cachedUserId: string | null;
} {
  const cached = getCachedProfileWithUser();
  if (cached && cached.profile.display_name) {
    // We have a complete cached profile - start as "ready"
    // The async session check will validate this is still correct
    return {
      profile: cached.profile,
      initialized: true,
      loading: false,
      profileLoading: false,
      cachedUserId: cached.userId,
    };
  }
  // No valid cache - need to wait for async check
  return {
    profile: null,
    initialized: false,
    loading: true,
    profileLoading: true,
    cachedUserId: null,
  };
}

// Compute initial state once at module load
const initialAuthState = getInitialAuthState();

function setCachedProfile(profile: Profile | null, userId?: string) {
  try {
    if (profile && userId) {
      const cacheData: CachedProfileData = {
        profile,
        userId,
        cachedAt: Date.now(),
      };
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cacheData));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  
  // SYNCHRONOUS HYDRATION: Use pre-computed initial state from cache
  // This eliminates flash by starting with cached profile if available
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(initialAuthState.profile);
  const [loading, setLoading] = useState(initialAuthState.loading);
  const [profileLoading, setProfileLoading] = useState(initialAuthState.profileLoading);
  const [profileError, setProfileError] = useState(false);
  const [initialized, setInitialized] = useState(initialAuthState.initialized);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  // Track the cached userId we started with (for validation)
  const [cachedUserId] = useState(initialAuthState.cachedUserId);

  // Flag to track if this is a fresh login (not a page refresh)
  const [isFreshLogin, setIsFreshLogin] = useState(false);

  // CRITICAL FIX: applyTheme is now a direct parameter, not dependent on React state
  // This avoids stale closure issues during Google OAuth where isFreshLogin state
  // wasn't available in the callback at the right time
  const fetchProfile = useCallback(async (userId: string, retries = 5, applyTheme = false): Promise<Profile | null> => {
    setProfileError(false);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create a timeout promise to prevent hanging - increased to 15s for slow connections
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const fetchPromise = supabase
          .from("profiles")
          .select("id, display_name, avatar_url, ignite_points, has_sausage_reward, theme_preference, events_view_mode")
          .eq("id", userId)
          .maybeSingle();
        
        const result = await Promise.race([fetchPromise, timeoutPromise]);
        const { data, error } = result;
        
        if (error) {
          console.error(`Error fetching profile (attempt ${attempt}/${retries}):`, error);
          // Retry on any error - be more aggressive
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          setProfileError(true);
          return null;
        }
        
        if (data) {
          const profileData = data as Profile;
          setProfile(profileData);
          setCachedProfile(profileData, userId);
          setProfileError(false);
          
          // HARD RULE: If profile has display_name, set the profileCompleted flag for this user
          // This ensures invite flow progress dots never appear for users with completed profiles
          if (profileData.display_name) {
            markProfileCompleted(userId);
          }
          
          // CRITICAL FIX: Apply theme when applyTheme=true (passed by caller)
          // The caller determines if this is a fresh login, not React state
          // This fixes Google OAuth where the closure captured stale isFreshLogin state
          if (applyTheme) {
            const root = window.document.documentElement;
            const themeToApply = profileData.theme_preference || 'light'; // Default to light for new users
            root.classList.remove('light', 'dark');
            root.classList.add(themeToApply);
            root.style.colorScheme = themeToApply;
            localStorage.setItem('app-theme', themeToApply);
            console.log('[Auth] Applied theme preference on fresh login:', themeToApply, '(was:', localStorage.getItem('app-theme'), ')');
          }
          
          return profileData;
        }
        
        // No profile found - this is okay for new users, not an error
        console.log('No profile found for user:', userId);
        return null;
      } catch (err: any) {
        console.error(`Exception fetching profile (attempt ${attempt}/${retries}):`, err);
        if (attempt < retries) {
          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        setProfileError(true);
        return null;
      }
    }
    setProfileError(true);
    return null;
  }, []); // No dependencies - applyTheme is a parameter, not state

  // MESSAGE_NOTIFICATION_TYPES imported from @/lib/notificationTypes

  const fetchUnreadCount = async (userId: string) => {
    const [allResult, messagesResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false)
        .in("type", MESSAGE_NOTIFICATION_TYPES)
    ]);
    
    setUnreadCount(allResult.count || 0);
    setUnreadMessagesCount(messagesResult.count || 0);
  };

  useEffect(() => {
    let mounted = true;
    let profileFetched = false;
    
    const handleSession = async (currentSession: Session | null, isInitial = false, applyTheme = false) => {
      if (!mounted || !currentSession?.user) return;
      
      const userId = currentSession.user.id;
      
      // CHECK: If we started with a cached profile, validate it's for this user
      // If userId mismatch, we need to clear and refetch - this is a USER SWITCH scenario
      const isUserSwitch = cachedUserId && cachedUserId !== userId;
      if (isUserSwitch) {
        console.log('[Auth] Session user differs from cached - clearing stale cache for user switch');
        setProfile(null);
        setCachedProfile(null);
        // Clear the old cache from localStorage too
        localStorage.removeItem(PROFILE_CACHE_KEY);
        // Reset the profileFetched flag since we're switching users
        profileFetched = false;
      }
      
      // Prevent duplicate fetches within same session (but allow user switches)
      if (profileFetched && !isInitial && !isUserSwitch) return;
      profileFetched = true;
      
      // If we already have initialized=true from sync hydration AND userId matches (no switch),
      // just do a background refresh - no need to block
      if (!isUserSwitch && initialized && profile?.display_name && cachedUserId === userId) {
        // Already ready from sync hydration - just background refresh
        fetchProfile(userId, 5, false).catch(() => {});
        // Prefetch other data
        setTimeout(() => {
          prefetchUserData(queryClient, userId).catch(console.error);
          fetchUnreadCount(userId).catch(console.error);
          const email = currentSession.user.email;
          const displayName = currentSession.user.user_metadata?.full_name || 
                             currentSession.user.user_metadata?.name;
          if (email) {
            syncPasskeyAccountsFromDatabase(userId, email, displayName).catch(console.error);
          }
        }, 100);
        return;
      }
      
      // Small delay to ensure session is fully propagated to Supabase
      // This helps with RLS policies that check auth.uid()
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // If we have a cached profile for THIS USER with display_name, TRUST IT immediately
      // This eliminates the flash on page refresh - no need to wait for server
      // NOTE: Don't use cache if this is a user switch (cache was just cleared)
      const cached = isUserSwitch ? null : getCachedProfile(userId);
      if (cached && cached.id === userId && cached.display_name) {
        // TRUST the cached profile - user is already set up
        setProfile(cached);
        setProfileLoading(false);
        setLoading(false);
        setInitialized(true);
        
        // Background refresh - update cache silently, no blocking
        fetchProfile(userId, 5, false).catch(() => {
          // Silent fail - we already have valid cached data
        });
      } else if (cached && cached.id === userId && !cached.display_name) {
        // Cached profile exists but no display_name - need to complete profile
        // Still trust the cache for immediate render
        setProfile(cached);
        setProfileLoading(false);
        setLoading(false);
        setInitialized(true);
        
        // Background refresh
        fetchProfile(userId, 5, false).catch(() => {});
      } else {
        // No cache or user switch - must fetch profile before proceeding
        console.log('[Auth] Fetching profile for user:', userId, isUserSwitch ? '(user switch)' : '');
        setProfileLoading(true);
        try {
          const fetchedProfile = await fetchProfile(userId, 5, applyTheme);
          if (mounted) {
            // Use queueMicrotask to batch state updates
            queueMicrotask(() => {
              if (mounted) {
                setProfileLoading(false);
                setLoading(false);
                setInitialized(true);
                console.log('[Auth] Profile fetch complete, initialized:', !!fetchedProfile);
              }
            });
          }
        } catch (err) {
          console.error('[Auth] Profile fetch failed:', err);
          if (mounted) {
            setProfileLoading(false);
            setLoading(false);
            setInitialized(true); // Initialize even on error to prevent hang
          }
        }
      }
      // Background prefetch - fire and forget
      setTimeout(() => {
        prefetchUserData(queryClient, userId).catch(console.error);
        fetchUnreadCount(userId).catch(console.error);
        // Sync passkey accounts from database to restore any lost localStorage data
        const email = currentSession.user.email;
        const displayName = currentSession.user.user_metadata?.full_name || 
                           currentSession.user.user_metadata?.name;
        if (email) {
          syncPasskeyAccountsFromDatabase(userId, email, displayName).catch(console.error);
        }
      }, 100);
    };
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!mounted) return;
        
        console.log('Auth state change:', event, currentSession?.user?.id);
        
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        
        if (event === 'SIGNED_IN') {
          // FRESH LOGIN: Reset state to block AppLayout until profile is fetched
          // This prevents the double-flash to complete-profile page
          setIsFreshLogin(true);
          setInitialized(false);
          setLoading(true);
          setProfileLoading(true);
          handleSession(currentSession, false, true);
        } else if ((event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && currentSession?.user) {
          // Page refresh or token refresh - don't override theme
          setIsFreshLogin(false);
          handleSession(currentSession, event === 'INITIAL_SESSION', false);
        } else if (event === 'SIGNED_OUT') {
          profileFetched = false;
          setIsFreshLogin(false);
          setProfile(null);
          setCachedProfile(null);
          setUnreadCount(0);
          setUnreadMessagesCount(0);
          setProfileLoading(false);
          setLoading(false);
          setInitialized(true); // Stay initialized but with no user
        }
      }
    );

    // Check for existing session (initial load) with timeout
    // PWA launches can hang on getSession if network is slow/offline
    // Increased timeout for slower networks (e.g., mobile on 3G)
    const sessionTimeout = setTimeout(() => {
      if (mounted && loading) {
        console.warn('Session check timed out, proceeding with cached state');
        setLoading(false);
        setProfileLoading(false);
        setInitialized(true); // Mark as initialized even on timeout
      }
    }, 10000); // 10 second timeout for slow connections

    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      clearTimeout(sessionTimeout);
      if (!mounted) return;
      
      console.log('Initial session check:', existingSession?.user?.id);
      
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      
      if (existingSession?.user && !profileFetched) {
        // Initial page load - don't apply theme from profile (localStorage is source of truth)
        await handleSession(existingSession, true, false);
      } else {
        // No session - done loading
        if (mounted) {
          setProfileLoading(false);
          setLoading(false);
          setInitialized(true); // Mark as initialized
        }
      }
    }).catch(err => {
      clearTimeout(sessionTimeout);
      console.error('Error getting session:', err);
      if (mounted) {
        setLoading(false);
        setProfileLoading(false);
        setInitialized(true); // Mark as initialized even on error
      }
    });

    return () => {
      mounted = false;
      clearTimeout(sessionTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile, queryClient]);

  // Real-time notifications subscription and push registration
  useEffect(() => {
    if (!user) return;

    // Silently enable push notifications if permission already granted
    const setupPushNotifications = async () => {
      // Only attempt if notifications are supported and already permitted
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return; // Silently skip - user can enable via settings
      }
      
      try {
        // Use silent mode - don't prompt, just subscribe if already permitted
        const result = await subscribeToPushNotifications(user.id, true);
        if (result.success) {
          console.log('[Auth] Push notifications enabled on login');
        }
        // Don't log errors in silent mode - it's expected to fail if not set up
      } catch (error) {
        // Silently ignore errors in auto-setup
      }
    };
    
    setupPushNotifications();

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setUnreadCount((prev) => prev + 1);
          
          const notificationType = (payload.new as any)?.type;
          if (MESSAGE_NOTIFICATION_TYPES.includes(notificationType)) {
            setUnreadMessagesCount((prev) => prev + 1);
          }
          
          const message = (payload.new as any)?.message || 'You have a new notification';
          showBrowserNotification('Ignite', message, () => {
            window.location.href = '/notifications';
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).is_read === true) {
            fetchUnreadCount(user.id);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchUnreadCount(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const signUp = async (email: string, password: string) => {
    // Check for pending redirect (e.g., from invite link)
    const pendingRedirect = sessionStorage.getItem("redirectAfterAuth");
    const redirectUrl = pendingRedirect 
      ? `${window.location.origin}${pendingRedirect}`
      : `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signInWithGoogle = async () => {
    // Check for pending redirect (e.g., from invite link)
    const pendingRedirect = sessionStorage.getItem("redirectAfterAuth");
    const redirectUrl = pendingRedirect 
      ? `${window.location.origin}${pendingRedirect}`
      : `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setCachedProfile(null);
    // Keep profile/club/team caches for faster re-login (public data)
    // Only clear security-sensitive data
    clearRolesCache(); // Clear cached user roles (security-critical)
    setUnreadCount(0);
    setUnreadMessagesCount(0);
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const refreshUnreadCount = async () => {
    if (user) {
      await fetchUnreadCount(user.id);
    }
  };

  const clearUnreadCount = () => {
    setUnreadCount(0);
    setUnreadMessagesCount(0);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      profileLoading,
      profileError,
      initialized,
      unreadCount,
      unreadMessagesCount,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
      refreshUnreadCount,
      clearUnreadCount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
