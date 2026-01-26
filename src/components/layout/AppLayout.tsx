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
  // Theme loading happens asynchronously - we don't block on it
  useClubTheme();
  const [retrying, setRetrying] = useState(false);
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === "dark" ? igniteIcon : igniteIconLight;

  // Debug logging for profile state - must be before any conditional returns
  useEffect(() => {
    console.log('[AppLayout] Profile state:', {
      loading,
      profileLoading,
      profileError,
      hasProfile: !!profile,
      displayName: profile?.display_name,
      userId: user?.id
    });
  }, [loading, profileLoading, profileError, profile, user]);

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

  // Show loading only when we have no user and no profile (true initial load)
  // If we have a cached profile, skip loading screen entirely
  // Don't block on theme ready - the theme will apply when ready without blocking UI
  if (loading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <img src={logo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  if (!user) {
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

  // If profile is null and still loading, show loading screen
  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <img src={logo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
        {!profileLoading && (
          <Button onClick={async () => {
            setRetrying(true);
            await refreshProfile();
            setRetrying(false);
          }}>
            Retry
          </Button>
        )}
      </div>
    );
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
