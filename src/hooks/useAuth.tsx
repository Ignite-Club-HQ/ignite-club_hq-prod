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

function getCachedProfile(): Profile | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function setCachedProfile(profile: Profile | null) {
  try {
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const cachedProfile = getCachedProfile();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  // If we have cached profile, don't block UI - start with loading=false
  const [loading, setLoading] = useState(!cachedProfile);
  const [profileLoading, setProfileLoading] = useState(!cachedProfile);
  const [profileError, setProfileError] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  const fetchProfile = useCallback(async (userId: string, retries = 5): Promise<Profile | null> => {
    setProfileError(false);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create a timeout promise to prevent hanging - increased to 15s for slow connections
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const fetchPromise = supabase
          .from("profiles")
          .select("id, display_name, avatar_url, ignite_points, has_sausage_reward, theme_preference")
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
          setCachedProfile(profileData);
          setProfileError(false);
          
          // Apply user's theme preference on login
          if (profileData.theme_preference) {
            const root = window.document.documentElement;
            root.classList.remove('light', 'dark');
            root.classList.add(profileData.theme_preference);
            root.style.colorScheme = profileData.theme_preference;
            localStorage.setItem('app-theme', profileData.theme_preference);
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
  }, []);

  const MESSAGE_NOTIFICATION_TYPES = [
    'team_message', 'club_message', 'group_message', 'broadcast',
    'message_reply', 'message_reaction', 'message_mention'
  ];

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
    
    const handleSession = async (currentSession: Session | null, isInitial = false) => {
      if (!mounted || !currentSession?.user) return;
      if (profileFetched && !isInitial) return;
      
      profileFetched = true;
      const userId = currentSession.user.id;
      
      // Small delay to ensure session is fully propagated to Supabase
      // This helps with RLS policies that check auth.uid()
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // If we have a cached profile, use it immediately - don't show loading
      const cached = getCachedProfile();
      if (cached && cached.id === userId) {
        setProfile(cached);
        setProfileLoading(false);
        setLoading(false);
        // Refresh profile in background
        fetchProfile(userId).catch(console.error);
      } else {
        // No cache - fetch profile
        setProfileLoading(true);
        fetchProfile(userId)
          .finally(() => {
            if (mounted) {
              setProfileLoading(false);
              setLoading(false);
            }
          });
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
        
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && currentSession?.user) {
          handleSession(currentSession, event === 'INITIAL_SESSION');
        } else if (event === 'SIGNED_OUT') {
          profileFetched = false;
          setProfile(null);
          setCachedProfile(null);
          setUnreadCount(0);
          setUnreadMessagesCount(0);
          setProfileLoading(false);
          setLoading(false);
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
      }
    }, 10000); // 10 second timeout for slow connections

    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      clearTimeout(sessionTimeout);
      if (!mounted) return;
      
      console.log('Initial session check:', existingSession?.user?.id);
      
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      
      if (existingSession?.user && !profileFetched) {
        await handleSession(existingSession, true);
      } else {
        // No session - done loading
        if (mounted) {
          setProfileLoading(false);
          setLoading(false);
        }
      }
    }).catch(err => {
      clearTimeout(sessionTimeout);
      console.error('Error getting session:', err);
      if (mounted) {
        setLoading(false);
        setProfileLoading(false);
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
    const redirectUrl = `${window.location.origin}/`;
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
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
