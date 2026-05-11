import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Home, Calendar, MessageCircle, Image, Lock } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import {
  IOS_LAYOUT_RESET_EVENT,
  IOS_NAV_GUARD_EVENT,
  readSafeAreaInsetBottomPx,
} from "@/lib/iosLayoutStability";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";

const navItems = [
  { to: "/", icon: Home, label: "Home", requiresPro: false },
  { to: "/messages", icon: MessageCircle, label: "Messages", requiresPro: false },
  { to: "/events", icon: Calendar, label: "Schedule", requiresPro: false },
  { to: "/media", icon: Image, label: "Media", requiresPro: true },
];

const MIN_NATIVE_BOTTOM_INSET_PX = 20;
const IOS_NATIVE_BOTTOM_INSET_PX = 0;
const IOS_WEB_BOTTOM_INSET_PX = 0;
const MAX_IOS_NATIVE_BOTTOM_INSET_PX = 60;
const DEFAULT_NAV_GUARD_MS = 900;

export function BottomNav() {
  const { unreadMessagesCount: globalMessagesCount, user } = useAuth();
  const { activeClubFilter } = useClubTheme();

  // Per-club message unread count: count message-type notifications scoped to active club
  const { data: clubMessagesCount = 0 } = useQuery({
    queryKey: ["club-messages-unread", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user?.id || !activeClubFilter) return 0;
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("club_id", activeClubFilter)
        .eq("is_read", false)
        .in("type", MESSAGE_NOTIFICATION_TYPES);
      return count || 0;
    },
    enabled: !!user?.id && !!activeClubFilter,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const unreadMessagesCount = activeClubFilter ? clubMessagesCount : globalMessagesCount;
  const location = useLocation();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();

  const isChatThreadRoute = useMemo(() => {
    const path = location.pathname;
    if (path === "/messages/broadcast") return true;
    if (/^\/messages\/club\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/club-admin\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/dm\/[^/]+$/.test(path)) return true;
    if (/^\/groups\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/[^/]+$/.test(path) && path !== "/messages" && path !== "/messages/welcome") return true;
    return false;
  }, [location.pathname]);

  // Use both keyboard detection signals for maximum reliability on native
  const shouldHideNav = isChatThreadRoute && (isKeyboardOpen || nativeKbHeight > 0);

  const { data: userRoles, isLoading: isLoadingRoles } = useQuery({
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
    retry: 3,
    staleTime: 5 * 60 * 1000,
  });

  const isAppAdmin = userRoles?.some((r) => r.role === "app_admin");

  const { data: hasProAccess, isLoading: isLoadingProAccess } = useQuery({
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
    enabled: !!user && !!userRoles && userRoles.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Don't show lock while roles or pro access are still loading — assume unlocked to prevent flash
  const isLoadingAccess = isLoadingRoles || (!!userRoles && userRoles.length > 0 && isLoadingProAccess);
  const showProLock = !isLoadingAccess && hasProAccess === false && !isAppAdmin;

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
    if (isNativeIOS) return IOS_NATIVE_BOTTOM_INSET_PX;
    return IOS_WEB_BOTTOM_INSET_PX;
  }, [isNativeIOS, shouldStabilizeIOSLayout]);

  const [nativeSafeInsetPx, setNativeSafeInsetPx] = useState(nativeInsetFloorPx);
  const [navInteractionLocked, setNavInteractionLocked] = useState(false);
  const navGuardTimeoutRef = useRef<number | null>(null);

  const resolveBottomInsetPx = useCallback(() => {
    if (!shouldStabilizeIOSLayout) return nativeInsetFloorPx;
    if (!isNativeIOS) return nativeInsetFloorPx;

    const measuredInset = readSafeAreaInsetBottomPx();
    return Math.max(nativeInsetFloorPx, Math.min(measuredInset, MAX_IOS_NATIVE_BOTTOM_INSET_PX));
  }, [isNativeIOS, nativeInsetFloorPx, shouldStabilizeIOSLayout]);

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
    setNativeSafeInsetPx(resolveBottomInsetPx());
  }, [nativeInsetFloorPx, resolveBottomInsetPx]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const handleOrientationChange = () => {
      setNativeSafeInsetPx(resolveBottomInsetPx());
      lockNavInteractions(DEFAULT_NAV_GUARD_MS);
    };

    window.addEventListener("orientationchange", handleOrientationChange);
    return () => window.removeEventListener("orientationchange", handleOrientationChange);
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined" || typeof document === "undefined") return;

    const handleViewportResume = () => {
      if (document.visibilityState === "hidden") return;
      setNativeSafeInsetPx(resolveBottomInsetPx());
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
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const resetToFloor = (durationMs = DEFAULT_NAV_GUARD_MS) => {
      setNativeSafeInsetPx(resolveBottomInsetPx());
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
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout) return;
    lockNavInteractions(700);
    setNativeSafeInsetPx(resolveBottomInsetPx());
    // After leaving a chat thread on iOS, the document/window can be left
    // scrolled (composer focus + Keyboard.setScroll interactions), which
    // pushes the fixed bottom nav partly below the home-indicator area on
    // the destination page. Force the outer window back to the top across
    // a short settle window so labels never sit clipped under the indicator.
    if (typeof window === "undefined") return;
    const resetWindow = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (typeof document !== "undefined") {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    resetWindow();
    requestAnimationFrame(resetWindow);
    const t1 = window.setTimeout(resetWindow, 120);
    const t2 = window.setTimeout(resetWindow, 360);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [shouldStabilizeIOSLayout, location.pathname, lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardTimeoutRef.current !== null) {
        window.clearTimeout(navGuardTimeoutRef.current);
        navGuardTimeoutRef.current = null;
      }
    };
  }, []);

  const nativeInsetFloor = `${nativeSafeInsetPx}px`;
  // For native iOS, use the live CSS env() value as the source of truth so the nav
  // tracks the real home-indicator inset without JS measurement lag and without
  // any extra hard-coded floor that would push the bar away from the bottom edge.
  // On native iOS, guarantee at least 8px below the labels so the home-indicator
  // region never visually crowds the nav text on devices that report a small or
  // zero safe-area-inset-bottom (e.g., landscape, iPad, older form factors).
  const navBottomInset = isNativeIOS
    ? "max(env(safe-area-inset-bottom, 0px), 8px)"
    : shouldStabilizeIOSLayout
      ? nativeInsetFloor
      : isAndroidNative
        ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
        : "max(env(safe-area-inset-bottom, 0px), 8px)";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--bottom-nav-safe-inset", navBottomInset);
    root.style.setProperty("--bottom-nav-safe-inset-px", nativeInsetFloor);
    // When nav is hidden (keyboard open on chat), set offset to 0 so chat viewport expands
    root.style.setProperty(
      "--bottom-nav-offset",
      shouldHideNav ? "0px" : `calc(4rem + ${navBottomInset})`
    );
  }, [navBottomInset, nativeInsetFloor, shouldHideNav]);

  const gpuLayerStyle = shouldStabilizeIOSLayout
    ? { willChange: "transform", backfaceVisibility: "hidden" as const }
    : {};

  const hideTransform = shouldHideNav ? "translateY(100%)" : "translate3d(0,0,0)";

  return (
    <>
      {isNativePlatform && !shouldHideNav && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none"
          style={{
            height: `calc(4rem + ${navBottomInset})`,
            transform: "translate3d(0,0,0)",
            touchAction: "none",
            overscrollBehavior: "contain",
            ...gpuLayerStyle,
          }}
        />
      )}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card transition-transform duration-200 ease-out"
        style={{
          paddingBottom: navBottomInset,
          transform: hideTransform,
          touchAction: "none",
          overscrollBehavior: "contain",
          ...gpuLayerStyle,
        }}
        onTouchMove={(e) => {
          // Prevent Android WebView from treating drags on the bottom nav as
          // page-pull gestures (which scroll the whole app off-screen).
          if (e.cancelable) e.preventDefault();
        }}
        aria-label="Main navigation"
        aria-hidden={shouldHideNav}
      >
        <div className="flex items-center justify-around min-h-[4rem] max-w-lg mx-auto px-2">
          {navItems.map(({ to, icon: Icon, label, requiresPro }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              aria-current={undefined}
              onClick={(e) => {
                if (navInteractionLocked) {
                  e.preventDefault();
                }
              }}
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
                        className={cn(
                          "absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full font-semibold text-[9px] leading-none ring-2 ring-card text-white tabular-nums",
                          "bg-[hsl(0_72%_55%)]",
                          unreadMessagesCount > 9
                            ? "min-w-[16px] h-[15px] px-1"
                            : "w-[15px] h-[15px]"
                        )}
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
