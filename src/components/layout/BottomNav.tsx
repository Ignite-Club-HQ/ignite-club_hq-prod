import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Home, Calendar, MessageCircle, Image, Lock } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import {
  IOS_LAYOUT_RESET_EVENT,
  IOS_NAV_GUARD_EVENT,
} from "@/lib/iosLayoutStability";

const navItems = [
  { to: "/", icon: Home, label: "Home", requiresPro: false },
  { to: "/messages", icon: MessageCircle, label: "Messages", requiresPro: false },
  { to: "/events", icon: Calendar, label: "Schedule", requiresPro: false },
  { to: "/media", icon: Image, label: "Media", requiresPro: true },
];

const MIN_NATIVE_BOTTOM_INSET_PX = 20;
const IOS_PHONE_BOTTOM_INSET_PX = 34;
const IOS_WEB_BOTTOM_INSET_PX = 16;
const DEFAULT_NAV_GUARD_MS = 900;

export function BottomNav() {
  const { unreadMessagesCount, user } = useAuth();
  const location = useLocation();

  const { data: userRoles } = useQuery({
    queryKey: ["user-roles-nav", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const isAppAdmin = userRoles?.some((r) => r.role === "app_admin");

  const { data: hasProAccess } = useQuery({
    queryKey: ["user-has-pro-access-nav", user?.id],
    queryFn: async () => {
      const clubIds = (userRoles?.filter((r) => r.club_id).map((r) => r.club_id) as string[] | undefined) || [];
      const teamIds = (userRoles?.filter((r) => r.team_id).map((r) => r.team_id) as string[] | undefined) || [];

      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);

        teamsData?.forEach((team) => {
          if (team.club_id && !clubIds.includes(team.club_id)) {
            clubIds.push(team.club_id);
          }
        });
      }

      if (clubIds.length === 0 && teamIds.length === 0) return false;

      if (clubIds.length > 0) {
        const { data: clubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", clubIds);

        const hasClubPro = clubSubs?.some(
          (subscription) =>
            subscription.is_pro ||
            subscription.is_pro_football ||
            subscription.admin_pro_override ||
            subscription.admin_pro_football_override,
        );

        if (hasClubPro) return true;
      }

      if (teamIds.length > 0) {
        const { data: teamSubs } = await supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", teamIds);

        const hasTeamPro = teamSubs?.some(
          (subscription) =>
            subscription.is_pro ||
            subscription.is_pro_football ||
            subscription.admin_pro_override ||
            subscription.admin_pro_football_override,
        );

        if (hasTeamPro) return true;
      }

      return false;
    },
    enabled: !!user && !!userRoles,
  });

  const isLoadingAccess = !userRoles || hasProAccess === undefined;
  const showProLock = !isLoadingAccess && !hasProAccess && !isAppAdmin;

  const isNativePlatform = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const isNativeIOS = isNativePlatform && platform === "ios";
  const isAndroidNative = isNativePlatform && platform === "android";

  const isIOSEnvironment = useMemo(() => {
    if (typeof navigator === "undefined") return platform === "ios";
    const userAgent = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const iPadOSDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOSDesktopMode || platform === "ios";
  }, [platform]);

  const shouldStabilizeIOSLayout = isIOSEnvironment;

  const nativeInsetFloorPx = useMemo(() => {
    if (!shouldStabilizeIOSLayout) return MIN_NATIVE_BOTTOM_INSET_PX;
    if (!isNativeIOS) return IOS_WEB_BOTTOM_INSET_PX;
    if (typeof window === "undefined") return IOS_PHONE_BOTTOM_INSET_PX;

    const shortestScreenEdgePx = Math.min(
      window.screen?.width ?? window.innerWidth,
      window.screen?.height ?? window.innerHeight,
    );

    return shortestScreenEdgePx <= 430 ? IOS_PHONE_BOTTOM_INSET_PX : MIN_NATIVE_BOTTOM_INSET_PX;
  }, [isNativeIOS, shouldStabilizeIOSLayout]);

  const [nativeSafeInsetPx, setNativeSafeInsetPx] = useState(nativeInsetFloorPx);
  const [navInteractionLocked, setNavInteractionLocked] = useState(false);
  const navGuardTimeoutRef = useRef<number | null>(null);

  const lockNavInteractions = useCallback((durationMs = DEFAULT_NAV_GUARD_MS) => {
    if (typeof window === "undefined") return;
    if (navGuardTimeoutRef.current !== null) window.clearTimeout(navGuardTimeoutRef.current);
    setNavInteractionLocked(true);
    navGuardTimeoutRef.current = window.setTimeout(() => {
      setNavInteractionLocked(false);
      navGuardTimeoutRef.current = null;
    }, Math.max(250, durationMs));
  }, []);

  useEffect(() => {
    setNativeSafeInsetPx(nativeInsetFloorPx);
  }, [nativeInsetFloorPx]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const handleOrientationChange = () => {
      setNativeSafeInsetPx(nativeInsetFloorPx);
      lockNavInteractions(DEFAULT_NAV_GUARD_MS);
    };

    window.addEventListener("orientationchange", handleOrientationChange);
    return () => window.removeEventListener("orientationchange", handleOrientationChange);
  }, [lockNavInteractions, nativeInsetFloorPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined" || typeof document === "undefined") return;

    const handleViewportResume = () => {
      if (document.visibilityState === "hidden") return;
      setNativeSafeInsetPx(nativeInsetFloorPx);
      lockNavInteractions(1200);
    };

    window.addEventListener("focus", handleViewportResume);
    window.addEventListener("pageshow", handleViewportResume);
    document.addEventListener("visibilitychange", handleViewportResume);

    return () => {
      window.removeEventListener("focus", handleViewportResume);
      window.removeEventListener("pageshow", handleViewportResume);
      document.removeEventListener("visibilitychange", handleViewportResume);
    };
  }, [lockNavInteractions, nativeInsetFloorPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const resetToFloor = (durationMs = DEFAULT_NAV_GUARD_MS) => {
      setNativeSafeInsetPx(nativeInsetFloorPx);
      lockNavInteractions(durationMs);
    };

    const handleLayoutReset = () => resetToFloor(1200);
    const handleNavGuard = (event: Event) => {
      const ce = event as CustomEvent<{ durationMs?: number }>;
      resetToFloor(ce.detail?.durationMs ?? DEFAULT_NAV_GUARD_MS);
    };

    window.addEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
    window.addEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);

    return () => {
      window.removeEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
      window.removeEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);
    };
  }, [lockNavInteractions, nativeInsetFloorPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout) return;
    lockNavInteractions(700);
    setNativeSafeInsetPx(nativeInsetFloorPx);
  }, [shouldStabilizeIOSLayout, location.pathname, lockNavInteractions, nativeInsetFloorPx]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardTimeoutRef.current !== null) {
        window.clearTimeout(navGuardTimeoutRef.current);
        navGuardTimeoutRef.current = null;
      }
    };
  }, []);

  const nativeInsetFloor = `${nativeSafeInsetPx}px`;
  const navBottomInset = shouldStabilizeIOSLayout
    ? nativeInsetFloor
    : isAndroidNative
      ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
      : "env(safe-area-inset-bottom, 0px)";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--bottom-nav-safe-inset", navBottomInset);
    root.style.setProperty("--bottom-nav-safe-inset-px", nativeInsetFloor);
    root.style.setProperty("--bottom-nav-offset", `calc(4rem + ${navBottomInset})`);
  }, [navBottomInset, nativeInsetFloor]);

  const gpuLayerStyle = shouldStabilizeIOSLayout
    ? { transform: "translate3d(0,0,0)", willChange: "transform", backfaceVisibility: "hidden" as const }
    : {};

  return (
    <>
      {isNativePlatform && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none"
          style={{
            height: `calc(4rem + ${navBottomInset})`,
            ...gpuLayerStyle,
          }}
        />
      )}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card backdrop-blur-lg",
          navInteractionLocked && "pointer-events-none",
        )}
        style={{
          paddingBottom: navBottomInset,
          ...gpuLayerStyle,
        }}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-around min-h-[4rem] max-w-lg mx-auto px-2">
          {navItems.map(({ to, icon: Icon, label, requiresPro }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              aria-current={undefined}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center flex-1 py-2 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <span aria-current={isActive ? "page" : undefined} className="flex flex-col items-center">
                  <div className={cn("p-1.5 rounded-xl transition-all relative", isActive && "bg-primary/10")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {label === "Messages" && unreadMessagesCount > 0 && (
                      <span
                        className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 animate-pulse-glow shadow-sm"
                        aria-label={`${unreadMessagesCount} unread messages`}
                      >
                        {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
                      </span>
                    )}
                    {requiresPro && showProLock && (
                      <Lock className="h-3 w-3 text-muted-foreground absolute -top-1 -right-1" aria-label="Pro feature" />
                    )}
                  </div>
                  <span className="text-xs font-medium mt-0.5">{label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
