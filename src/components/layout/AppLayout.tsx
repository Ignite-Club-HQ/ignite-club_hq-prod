import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useChatRouteOverscrollLock } from "@/hooks/useChatRouteOverscrollLock";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SkipToContent } from "@/components/SkipToContent";
import { NativeNotificationPrompt } from "@/components/NativeNotificationPrompt";
import { PendingInviteWelcomeDialog } from "@/components/PendingInviteWelcomeDialog";
import { useAdMobInit } from "@/hooks/useAdMob";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import igniteIcon from "@/assets/ignite-icon.png";
import { Capacitor } from "@capacitor/core";

const LazyDeepLinkGate = lazy(() => import("@/components/DeepLinkGate"));

export function AppLayout() {
  const { user, profile, loading, profileLoading, profileError, refreshProfile, initialized } = useAuth();
  useAdMobInit();
  useActivityTracking();
  const { isThemeReady } = useClubTheme();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);
  const [themeTimeout, setThemeTimeout] = useState(false);
  
  const isChatThreadRoute = useMemo(() => {
    const path = location.pathname;

    if (path === "/messages/broadcast") return true;
    if (/^\/messages\/club\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/dm\/[^/]+$/.test(path)) return true;
    if (/^\/groups\/[^/]+$/.test(path)) return true;

    // Team chat route: /messages/:teamId (exclude static routes)
    if (/^\/messages\/[^/]+$/.test(path) && path !== "/messages" && path !== "/messages/welcome") {
      return true;
    }

    return false;
  }, [location.pathname]);

  useChatRouteOverscrollLock(isChatThreadRoute);

  // When bottom nav is hidden in chat threads, reset the offset so inputs sit at the bottom
  useEffect(() => {
    if (isChatThreadRoute) {
      document.documentElement.style.setProperty("--bottom-nav-offset", "env(safe-area-inset-bottom, 0px)");
    }
    // BottomNav will re-set the variable when it mounts on non-chat routes
  }, [isChatThreadRoute]);

  const loadingLogo = useMemo(() => igniteIcon, []);

  // Debug logging for profile state - must be before any conditional returns
  useEffect(() => {
    console.log('[AppLayout] Profile state:', {
      initialized,
      loading,
      profileLoading,
      profileError,
      hasProfile: !!profile,
      displayName: profile?.display_name,
      userId: user?.id,
      isThemeReady,
      themeTimeout
    });
  }, [initialized, loading, profileLoading, profileError, profile, user, isThemeReady, themeTimeout]);

  // Theme loading timeout - don't block forever waiting for theme
  useEffect(() => {
    if (profile && !isThemeReady && !themeTimeout) {
      const timer = setTimeout(() => {
        console.log('[AppLayout] Theme loading timeout - proceeding without waiting');
        setThemeTimeout(true);
      }, 1500); // 1.5 second timeout for theme loading
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

  // CRITICAL: Show loading screen FIRST before ANY routing decisions
  // This prevents any flash of wrong content during initialization
  const shouldWaitForTheme = profile && !isThemeReady && !themeTimeout;
  
  // If we already have a valid profile with display_name, skip loading entirely
  // This prevents double-flash on login when cache is already populated
  const hasValidProfile = profile?.display_name;
  const isStillLoading = !hasValidProfile && (!initialized || loading || profileLoading);
  
  if (isStillLoading || shouldWaitForTheme) {
    // Show appropriate message based on auth state
    const loadingMessage = !initialized 
      ? "Checking authentication..." 
      : shouldWaitForTheme 
        ? "Applying theme..." 
        : "Loading your profile...";
    
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4" role="status" aria-live="polite">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    );
  }

  // Check if there's a pending OAuth callback that needs to be processed
  // This prevents redirecting to /auth before the OAuth code can be handled
  const hasPendingOAuth = typeof window !== 'undefined' && (
    sessionStorage.getItem('googleDriveOAuthCode') || 
    sessionStorage.getItem('googleDriveOAuthError')
  );
  
  // Check if there's a Supabase OAuth callback in progress (tokens in URL hash)
  // This happens when returning from Google OAuth - Supabase client needs time to process
  const hasOAuthTokensInUrl = typeof window !== 'undefined' && (
    window.location.hash.includes('access_token') ||
    window.location.hash.includes('refresh_token') ||
    window.location.search.includes('code=')
  );

  // If there's a pending OAuth, immediately navigate to vault
  // This prevents the flash to home screen after Google Drive authentication
  if (hasPendingOAuth && typeof window !== 'undefined' && window.location.pathname !== '/vault') {
    return <Navigate to="/vault" replace />;
  }

  // DEEP LINK GATE: Before redirecting unauthenticated users to /auth,
  // check if this is an in-app browser (Messenger, WhatsApp, etc.) on a deep-linkable route.
  // Show the DeepLinkGate interstitial so they can bounce to the native app.
  const isDeepLinkRoute = /^\/(events\/[^/]+|media\/[^/]+|vault\/folder\/[^/]+|share)$/.test(location.pathname);
  const isNativePlatform = Capacitor.isNativePlatform();
  const userAgent = navigator.userAgent || "";
  const isInApp = !isNativePlatform && /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|LinkedInApp|Messenger/i.test(userAgent);

  if (!user && isDeepLinkRoute && isInApp && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }>
        <LazyDeepLinkGate />
      </Suspense>
    );
  }

  // Preserve current destination for post-auth return (all protected routes, not just deep links)
  if (!user && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    if (typeof window !== 'undefined') {
      const redirectPath = `${location.pathname}${location.search}${location.hash}`;
      if (redirectPath && redirectPath !== '/' && redirectPath !== '/auth') {
        sessionStorage.setItem("redirectAfterAuth", redirectPath);
      }
    }
    return <Navigate to="/auth" replace />;
  }

  // Show retry screen if profile fetch failed (don't redirect to complete-profile)
  if (profileError && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4" role="alert" aria-live="assertive">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        {retrying ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
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

  // Only apply pt-safe padding for PWA/web - native apps handle this via StatusBarManager
  const isNative = Capacitor.isNativePlatform();

  const mainClassName = isChatThreadRoute
    ? "flex-1 min-h-0 max-w-lg mx-auto w-full overflow-hidden px-0 pb-0"
    : "flex-1 pb-28 px-4 max-w-lg mx-auto w-full";
  
  return (
    <div className="min-h-screen bg-background flex flex-col overscroll-none pt-safe">
      <SkipToContent />
      <AppHeader />
      <main id="main-content" aria-label="Main content" className={mainClassName}>
        <Outlet />
      </main>
      {!isChatThreadRoute && <BottomNav />}
      <OfflineIndicator />
      <NativeNotificationPrompt userId={user?.id} />
      <PendingInviteWelcomeDialog />
    </div>
  );
}
