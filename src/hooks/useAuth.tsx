import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
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
import { fetchUnreadMessageCounts, getTotalUnreadMessageCount } from "@/lib/unreadMessageCounts";
import { markProfileCompleted } from "@/components/InviteFlowProgress";
import { isNativePlatform, unregisterNativePush } from "@/lib/nativePush";

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  ignite_points: number;
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
  profileResolved: boolean; // True only after profile has been fetched from server at least once
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

  const waitForSessionUser = useCallback(async (expectedUserId: string, maxAttempts = 8): Promise<Session | null> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, error } = await supabase.auth.getSession();
        const session = data.session;

        if (!error && session?.user?.id === expectedUserId && session.access_token) {
          return session;
        }
      } catch {
        // Ignore transient session restore errors while polling
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 120 * attempt));
      }
    }

    return null;
  }, []);
  
  // SYNCHRONOUS HYDRATION: Use pre-computed initial state from cache
  // This eliminates flash by starting with cached profile if available
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(initialAuthState.profile);
  const [loading, setLoading] = useState(initialAuthState.loading);
  const [profileLoading, setProfileLoading] = useState(initialAuthState.profileLoading);
  const [profileError, setProfileError] = useState(false);
  const [initialized, setInitialized] = useState(initialAuthState.initialized);
  // profileResolved: true once the profile has been fetched from the server at least once
  // for the current session. Prevents routing to /complete-profile based on stale/missing cache.
  const [profileResolved, setProfileResolved] = useState(!!initialAuthState.profile?.display_name);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  // Track the cached userId we started with (for validation)
  const [cachedUserId] = useState(initialAuthState.cachedUserId);

  // Flag to track if this is a fresh login (not a page refresh)
  const [isFreshLogin, setIsFreshLogin] = useState(false);
  
  // Ref to track the current user ID for use inside stable callbacks
  const currentUserIdRef = useRef<string | null>(null);

  // CRITICAL FIX: applyTheme is now a direct parameter, not dependent on React state
  // This avoids stale closure issues during Google OAuth where isFreshLogin state
  // wasn't available in the callback at the right time
  const fetchProfile = useCallback(async (userId: string, retries = 5, applyTheme = false, retryOnMissing = false): Promise<Profile | null> => {
    setProfileError(false);
    const maxMissingProfileAttempts = retryOnMissing ? retries : 1;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create a timeout promise to prevent hanging - increased to 15s for slow connections
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const fetchPromise = supabase
          .from("profiles")
          .select("id, display_name, avatar_url, ignite_points, theme_preference, events_view_mode")
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
          setProfileResolved(true);
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
          // Only apply if profile has display_name - skip for incomplete profiles going to CompleteProfilePage
          if (applyTheme && profileData.display_name) {
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
        
        const shouldRetryMissingProfile = retryOnMissing && attempt < maxMissingProfileAttempts;
        if (shouldRetryMissingProfile) {
          const delay = Math.min(300 * attempt, 1500);
          console.warn(`[Auth] Profile not available yet (attempt ${attempt}/${maxMissingProfileAttempts}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // No profile found - this is okay for new users, not an error
        console.log('No profile found for user:', userId);
        setProfileResolved(true);
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
    const [allResult, messageCounts] = await Promise.all([
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false),
      fetchUnreadMessageCounts(userId),
    ]);
    
    setUnreadCount(allResult.count || 0);
    setUnreadMessagesCount(getTotalUnreadMessageCount(messageCounts));
  };

  useEffect(() => {
    let mounted = true;
    let profileFetched = false;
    
    const handleSession = async (currentSession: Session | null, isInitial = false, applyTheme = false) => {
      if (!mounted || !currentSession?.user) {
        console.log('[Auth] handleSession early exit - mounted:', mounted, 'hasUser:', !!currentSession?.user);
        return;
      }
      
      const userId = currentSession.user.id;
      console.log('[Auth] handleSession called - userId:', userId, 'isInitial:', isInitial, 'applyTheme:', applyTheme, 'profileFetched:', profileFetched);
      
      // CHECK: If we started with a cached profile, validate it's for this user
      // If userId mismatch, we need to clear and refetch - this is a USER SWITCH scenario
      const isUserSwitch = cachedUserId && cachedUserId !== userId;
      if (isUserSwitch) {
        console.log('[Auth] Session user differs from cached - clearing stale cache for user switch');
        setProfile(null);
        setProfileResolved(false);
        setCachedProfile(null);
        // Clear the old cache from localStorage too
        localStorage.removeItem(PROFILE_CACHE_KEY);
        // Reset the profileFetched flag since we're switching users
        profileFetched = false;
      }
      
      // Prevent duplicate fetches within same session (but allow user switches)
      // CRITICAL: For SIGNED_IN event (isInitial=false, applyTheme=true), we MUST proceed
      // even if profileFetched is true from a previous INITIAL_SESSION
      const shouldSkip = profileFetched && !isInitial && !isUserSwitch && !applyTheme;
      if (shouldSkip) {
        console.log('[Auth] handleSession skipping - already fetched');
        return;
      }
      profileFetched = true;
      
      // If we already have initialized=true from sync hydration AND userId matches (no switch),
      // AND this is NOT a fresh login (applyTheme=true means fresh login), just do background refresh
      // CRITICAL: For fresh logins (applyTheme=true), we must NOT skip - we need to apply theme
      if (!isUserSwitch && !applyTheme && initialized && profile?.display_name && cachedUserId === userId) {
        console.log('[Auth] handleSession - using cached profile, background refresh only');
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

      const stableSession = await waitForSessionUser(userId, applyTheme ? 10 : 6);
      const sessionForBackgroundTasks = stableSession ?? currentSession;

      if (stableSession && mounted) {
        setSession(stableSession);
        setUser(stableSession.user);
      }
      
      // If we have a cached profile for THIS USER with display_name, TRUST IT immediately
      // This eliminates the flash on page refresh - no need to wait for server
      // NOTE: Don't use cache if this is a user switch (cache was just cleared)
      // CRITICAL: On fresh login (applyTheme=true), we must fetch to apply DB theme preference
      const cached = (isUserSwitch || applyTheme) ? null : getCachedProfile(userId);
      if (cached && cached.id === userId && cached.display_name) {
        // TRUST the cached profile - user is already set up
        setProfile(cached);
        setProfileResolved(true); // Cache with display_name is trustworthy
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
        // No cache, user switch, or fresh login - must fetch profile before proceeding
        console.log('[Auth] Fetching profile for user:', userId, isUserSwitch ? '(user switch)' : '', applyTheme ? '(fresh login)' : '');
        setProfileLoading(true);
        try {
          const fetchedProfile = await fetchProfile(userId, 5, applyTheme, true);
          if (mounted) {
            setProfileLoading(false);
            setLoading(false);
            setInitialized(true);
            console.log('[Auth] Profile fetch complete, initialized:', !!fetchedProfile);
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
        const email = sessionForBackgroundTasks.user.email;
        const displayName = sessionForBackgroundTasks.user.user_metadata?.full_name || 
                           sessionForBackgroundTasks.user.user_metadata?.name;
        if (email) {
          syncPasskeyAccountsFromDatabase(userId, email, displayName).catch(console.error);
        }
      }, 100);
    };
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!mounted) return;
        
        // Check if we're in a native app context
        const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                         (window as any).Capacitor?.isNativePlatform?.();
        
        console.log('Auth state change:', event, currentSession?.user?.id, 'isNative:', isNative);
        
        const incomingUserId = currentSession?.user?.id ?? null;
        const previousUserId = currentUserIdRef.current || cachedUserId;
        
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        currentUserIdRef.current = incomingUserId;
        
        if (event === 'PASSWORD_RECOVERY') {
          // Recovery session: do NOT treat as a fresh login (no cache clear,
          // no profile fetch redirect). Just hold the session and ensure the
          // user is on /reset-password so they can set a new password.
          console.log('[Auth] PASSWORD_RECOVERY event - routing to reset password');
          handleSession(currentSession, false, false);
          if (typeof window !== 'undefined' && window.location.pathname !== '/reset-password') {
            window.location.href = '/reset-password';
          }
        } else if (event === 'SIGNED_IN') {
          const isSameUserResuming = !!previousUserId && previousUserId === incomingUserId;
          
          if (isSameUserResuming) {
            // Same user resuming (e.g., phone lock/unlock, app background/foreground)
            // Do NOT clear query cache — this causes data to flash/disappear
            console.log('[Auth] SIGNED_IN event - same user resuming, skipping cache clear', isNative ? '(native app)' : '(web)');
            handleSession(currentSession, false, false);
          } else {
            // FRESH LOGIN or different user: Reset state to block AppLayout until profile is fetched
            console.log('[Auth] SIGNED_IN event - processing login', isNative ? '(native app)' : '(web)');
            // If we're on the reset password page, this SIGNED_IN is from the
            // recovery code exchange — do NOT redirect away or clear cache
            // aggressively, the user still needs to set their new password.
            const onResetPage = typeof window !== 'undefined' && window.location.pathname === '/reset-password';
            if (onResetPage) {
              console.log('[Auth] SIGNED_IN on /reset-password — treating as recovery, skipping cache clear');
              handleSession(currentSession, false, false);
            } else {
              // Clear all cached query data to force fresh fetches with the new session
              // This prevents stale/empty RLS results from a previous logged-out window
              queryClient.clear();
              setIsFreshLogin(true);
              setInitialized(false);
              setLoading(true);
              setProfileLoading(true);
              setProfileResolved(false);
              handleSession(currentSession, false, true);
            }
          }
        } else if ((event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && currentSession?.user) {
          // Page refresh or token refresh - don't override theme
          console.log('[Auth] Session restored:', event, isNative ? '(native app)' : '(web)');
          setIsFreshLogin(false);
          handleSession(currentSession, event === 'INITIAL_SESSION', false);
        } else if (event === 'SIGNED_OUT') {
          console.log('[Auth] SIGNED_OUT event');
          // Clear ALL cached query data - prevents stale data from being served
          // after re-login (same userId would match stale queryKeys)
          queryClient.clear();
          profileFetched = false;
          setIsFreshLogin(false);
          setProfile(null);
          setProfileResolved(false);
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
        // Check if we have a cached profile to fall back on
        const cachedFallback = getCachedProfileWithUser();
        if (cachedFallback && cachedFallback.profile.display_name) {
          console.warn('[Auth] Session check timed out - restoring from cache, will retry in background');
          setProfile(cachedFallback.profile);
          setLoading(false);
          setProfileLoading(false);
          setInitialized(true);
          
          // Background retry: silently re-check session after timeout
          // This handles transient Supabase latency spikes
          supabase.auth.getSession().then(async ({ data: { session: retrySession } }) => {
            if (!mounted) return;
            if (retrySession?.user) {
              console.log('[Auth] Background session retry succeeded');
              setSession(retrySession);
              setUser(retrySession.user);
              if (!profileFetched) {
                await handleSession(retrySession, true, false);
              }
            }
          }).catch(e => console.warn('[Auth] Background session retry failed:', e));
        } else {
          console.warn('[Auth] Session check timed out, no cache available');
          setLoading(false);
          setProfileLoading(false);
          setInitialized(true);
        }
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
  }, [fetchProfile, queryClient, waitForSessionUser]);

  // SESSION RECOVERY: Check session health when the app returns to the foreground.
  // On Android, forcing refreshSession() on every resume can race token rotation
  // and trigger refresh_token_not_found, which looks like a random logout.
  useEffect(() => {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                     (window as any).Capacitor?.isNativePlatform?.();
    let lastResumeCheck = 0;
    let recoveryInFlight = false;

    const recoverSession = async (source: string) => {
      const now = Date.now();
      if (recoveryInFlight || now - lastResumeCheck < 3000) return;
      lastResumeCheck = now;
      recoveryInFlight = true;

      console.log(`[Auth] ${source} - checking session health`);

      try {
        const hadCachedProfile = !!getCachedProfileWithUser();

        // First trust the stored session. This avoids unnecessary refresh-token
        // rotation on resume, which was the main source of Android logouts.
        const { data: currentData, error: currentError } = await supabase.auth.getSession();
        if (!currentError && currentData.session) {
          console.log(`[Auth] ${source} - session still valid`);
          setSession(currentData.session);
          setUser(currentData.session.user);
          return;
        }

        if (!hadCachedProfile) {
          console.log(`[Auth] ${source} - no prior session to recover`);
          return;
        }

        console.warn(`[Auth] ${source} - no active session found, attempting one-time refresh`);
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

        if (!refreshError && refreshData.session) {
          console.log(`[Auth] ${source} - session recovered via refresh`);
          setSession(refreshData.session);
          setUser(refreshData.session.user);
          return;
        }

        const refreshCode = (refreshError as { code?: string } | null)?.code;
        const refreshMessage = refreshError?.message ?? "";
        const tokenMissing = refreshCode === 'refresh_token_not_found' || /refresh token not found/i.test(refreshMessage);

        // Give Supabase a brief moment in case another refresh path already won the race.
        await new Promise(resolve => setTimeout(resolve, 250));

        const { data: retryData, error: retryError } = await supabase.auth.getSession();
        if (!retryError && retryData.session) {
          console.log(`[Auth] ${source} - session restored after retry`);
          setSession(retryData.session);
          setUser(retryData.session.user);
          return;
        }

        console.warn(`[Auth] ${source} - session unrecoverable`, refreshError ?? currentError ?? retryError ?? null);
        queryClient.clear();
        clearProfileCache();
        clearClubTeamCache();
        clearRolesCache();
        setUser(null);
        setSession(null);
        setProfile(null);
        setCachedProfile(null);
        setUnreadCount(0);
        setUnreadMessagesCount(0);
        setLoading(false);
        setProfileLoading(false);
        setInitialized(true);

        if (tokenMissing) {
          console.warn(`[Auth] ${source} - refresh token missing after resume; user must sign in again`);
        }
      } catch (err) {
        console.error(`[Auth] ${source} - error during recovery (possibly offline):`, err);
        // Network error - don't log out, user might just be offline
      } finally {
        recoveryInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverSession('visibilitychange');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Native apps: also listen for Capacitor App resume event
    // This fires more reliably than visibilitychange on Android
    let resumeListener: { remove: () => Promise<void> } | null = null;
    if (isNative) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('resume', () => {
          recoverSession('capacitor-resume');
        }).then(listener => {
          resumeListener = listener;
        }).catch(err => {
          console.warn('[Auth] Failed to attach resume listener:', err);
        });
      }).catch(() => {});
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resumeListener?.remove().catch(() => {});
    };
  }, [queryClient]);

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
          // Optimistic increment for instant UI feedback
          setUnreadCount((prev) => prev + 1);
          
          const notificationType = (payload.new as any)?.type;
          if (MESSAGE_NOTIFICATION_TYPES.includes(notificationType)) {
            setUnreadMessagesCount((prev) => prev + 1);
          }
          
          // Only show browser notification if push notifications are NOT active.
          // Push (web SW or native FCM) already displays the notification —
          // firing showBrowserNotification here too causes duplicates.
          const pushActive = isNativePlatform() ||
            (typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
             'serviceWorker' in navigator && navigator.serviceWorker.controller);
          
          if (!pushActive) {
            const message = (payload.new as any)?.message || 'You have a new notification';
            showBrowserNotification('Ignite', message, () => {
              window.location.href = '/notifications';
            });
          }
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
            // Sync club-scoped badges (AppHeader bell + BottomNav Messages badge)
            queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
            queryClient.invalidateQueries({ queryKey: ["club-messages-unread"] });
            queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
            queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
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
          queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["club-messages-unread"] });
          queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
          queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
        }
      )
      .subscribe();

    // Re-sync unread count from server when app becomes visible
    // This catches any drift from missed realtime events (common on mobile/native)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchUnreadCount(user.id);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also re-sync on focus (more reliable on some platforms)
    const handleFocus = () => {
      fetchUnreadCount(user.id);
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
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
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error as Error | null };
    } catch (err) {
      console.error('[Auth] signIn error:', err);
      return { error: err as Error };
    }
  };

  const signInWithGoogle = async () => {
    // Check for pending redirect (e.g., from invite link)
    const pendingRedirect = sessionStorage.getItem("redirectAfterAuth");
    
    // For native apps, use the published app URL for OAuth redirects
    // The WebView can't handle capacitor:// or ionic:// schemes for OAuth
    const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                     (window as any).Capacitor?.isNativePlatform?.();
    
    // Use the published app URL for native, or current origin for web
    // For native: OAuth will redirect to the published URL, which triggers App Links
    // and brings the user back into the native app with the tokens
    const baseUrl = isNative 
      ? 'https://ignite-club-launchpad.lovable.app'
      : window.location.origin;
    
    const redirectUrl = pendingRedirect 
      ? `${baseUrl}${pendingRedirect}`
      : `${baseUrl}/`;
      
    console.log('[Auth] Google OAuth redirect URL:', redirectUrl, 'isNative:', isNative);
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        // Skip the browser redirect - we'll handle token exchange in the app
        // This is needed for the native app to capture the callback
        skipBrowserRedirect: false,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    const currentUserId = user?.id;

    try {
      if (currentUserId && isNativePlatform()) {
        await unregisterNativePush(currentUserId);
      }
    } catch (error) {
      console.error('[Auth] Native push cleanup failed during sign out:', error);
    }

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setCachedProfile(null);
    currentUserIdRef.current = null; // Clear so re-login is treated as fresh (applies theme from DB)
    // Clear ALL React Query cache to prevent stale RLS data on re-login
    queryClient.clear();
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
      profileResolved,
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
