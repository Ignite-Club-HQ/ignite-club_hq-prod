import { useEffect, useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useTheme } from "next-themes";
import igniteIconLight from "@/assets/ignite-icon-light.png";
import igniteIcon from "@/assets/ignite-icon.png";

export function AppLayout() {
  const { user, profile, loading, profileLoading, profileError, refreshProfile } = useAuth();
  const { isThemeReady } = useClubTheme();
  const [retrying, setRetrying] = useState(false);
  const [themeTimeout, setThemeTimeout] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  
  // Prevent hydration mismatch - check localStorage for initial theme
  useEffect(() => {
    setMounted(true);
  }, []);

  const getInitialTheme = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('app-theme') || 'dark';
    }
    return 'dark';
  };

  const isDark = mounted ? resolvedTheme === "dark" : getInitialTheme() === "dark";
  const logo = isDark ? igniteIcon : igniteIconLight;

  // Debug logging for profile state - must be before any conditional returns
  useEffect(() => {
    console.log('[AppLayout] Profile state:', {
      loading,
      profileLoading,
      profileError,
      hasProfile: !!profile,
      displayName: profile?.display_name,
      userId: user?.id,
      isThemeReady,
      themeTimeout
    });
  }, [loading, profileLoading, profileError, profile, user, isThemeReady, themeTimeout]);

  // Theme loading timeout - don't block forever waiting for theme
  useEffect(() => {
    if (profile && !isThemeReady && !themeTimeout) {
      const timer = setTimeout(() => {
        console.log('[AppLayout] Theme loading timeout - proceeding without waiting');
        setThemeTimeout(true);
      }, 3000); // 3 second timeout for theme loading
      return () => clearTimeout(timer);
    }
  }, [profile, isThemeReady, themeTimeout]);

  // Reset theme timeout when user changes
  useEffect(() => {
    setThemeTimeout(false);
  }, [user?.id]);

  // Auto-retry when profile error occurs
  useEffect(() => {
    if (profileError && !profile && user && !retrying) {
      const timer = setTimeout(async () => {
        setRetrying(true);
        await refreshProfile();
        setRetrying(false);
      }, 5000); // Auto-retry after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [profileError, profile, user, retrying, refreshProfile]);

  // Check if there's a pending OAuth callback that needs to be processed
  // This prevents redirecting to /auth before the OAuth code can be handled
  const hasPendingOAuth = typeof window !== 'undefined' && (
    sessionStorage.getItem('googleDriveOAuthCode') || 
    sessionStorage.getItem('googleDriveOAuthError')
  );

  // If there's a pending OAuth, immediately navigate to vault
  // This prevents the flash to home screen after Google Drive authentication
  if (hasPendingOAuth && typeof window !== 'undefined' && window.location.pathname !== '/vault') {
    return <Navigate to="/vault" replace />;
  }

  // Consolidated loading check - show loading screen during initial load
  // Keep showing loading until BOTH auth AND profile are resolved
  // This prevents the "flash" to complete-profile before profile is fetched
  const shouldWaitForTheme = profile && !isThemeReady && !themeTimeout;
  
  // Show loading if:
  // 1. Auth is still loading, OR
  // 2. Profile is still loading (even if we have a cached profile, wait for server truth)
  // This prevents redirect to complete-profile before profile fetch completes
  const isStillLoading = loading || profileLoading;
  
  if (isStillLoading || shouldWaitForTheme) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <img src={logo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  // Don't redirect to auth if we have a pending OAuth callback
  // The user is authenticated - just waiting for session to initialize
  if (!user && !hasPendingOAuth) {
    return <Navigate to="/auth" replace />;
  }

  // Show retry screen if profile fetch failed (don't redirect to complete-profile)
  if (profileError && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <img src={logo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
        {retrying ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Reconnecting to server...
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground text-center px-4">
              Unable to load your profile. The server may be temporarily unavailable.
            </p>
            <p className="text-xs text-muted-foreground">Auto-retrying in 5 seconds...</p>
            <Button onClick={async () => {
              setRetrying(true);
              await refreshProfile();
              setRetrying(false);
            }}>
              Retry Now
            </Button>
          </>
        )}
      </div>
    );
  }

  // Profile completion gate - redirect to complete-profile if:
  // 1. Profile exists but display_name is missing (existing user needs to complete)
  // 2. Profile is null after loading finished (new user needs to create profile)
  // Only gate when profileLoading is false (we have server truth, not stale cache)
  // AND we have a stable profile state (not in transition)
  if (!profileLoading && !loading) {
    // If profile exists and has display_name, we're good - proceed to render
    if (profile?.display_name) {
      // Profile is complete, allow rendering
    } else if (profile && !profile.display_name) {
      // Profile exists but no display_name - needs completion
      console.log('[AppLayout] Redirecting to complete-profile: profile exists but no display_name');
      return <Navigate to="/complete-profile" replace />;
    } else if (!profile && !profileError) {
      // New user - profile doesn't exist yet, redirect to complete-profile to create it
      console.log('[AppLayout] Redirecting to complete-profile: no profile found');
      return <Navigate to="/complete-profile" replace />;
    }
  }

  // At this point, if we still don't have a profile, something went wrong
  // The consolidated loading check above should have caught this state
  if (!profile) {
    // This shouldn't happen, but redirect to complete-profile as fallback
    console.log('[AppLayout] Unexpected state: no profile after all checks');
    return <Navigate to="/complete-profile" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 pb-20 px-4 max-w-lg mx-auto w-full">
        <Outlet />
      </main>
      <BottomNav />
      <OfflineIndicator />
    </div>
  );
}
