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
  readSafeAreaInsetBottomPx,
} from "@/lib/iosLayoutStability";

const navItems = [
  { to: "/", icon: Home, label: "Home", requiresPro: false },
  { to: "/messages", icon: MessageCircle, label: "Messages", requiresPro: false },
  { to: "/events", icon: Calendar, label: "Schedule", requiresPro: false },
  { to: "/media", icon: Image, label: "Media", requiresPro: true },
];

const MIN_NATIVE_BOTTOM_INSET_PX = 20;
const IOS_PHONE_BOTTOM_INSET_PX = 34;
const MAX_NATIVE_BOTTOM_INSET_PX = 40;
const DEFAULT_NAV_GUARD_MS = 900;
const VIEWPORT_OFFSET_SYNC_DELAYS_MS = [0, 120, 320, 640, 980] as const;
const KEYBOARD_HEIGHT_THRESHOLD_PX = 120;
const MAX_VIEWPORT_OFFSET_COMPENSATION_PX = 120;

export function BottomNav() {
  const { unreadMessagesCount, user } = useAuth();
  const location = useLocation();

  // Check if user has Pro access (via any club subscription)
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

  const isAppAdmin = userRoles?.some(r => r.role === "app_admin");

  const { data: hasProAccess } = useQuery({
    queryKey: ["user-has-pro-access-nav", user?.id],
    queryFn: async () => {
      // Get user's club IDs through their roles
      const clubIds = userRoles?.filter(r => r.club_id).map(r => r.club_id) as string[] || [];
      const teamIds = userRoles?.filter(r => r.team_id).map(r => r.team_id) as string[] || [];

      // Get club IDs from team memberships
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);

        teamsData?.forEach(t => {
          if (t.club_id && !clubIds.includes(t.club_id)) {
            clubIds.push(t.club_id);
          }
        });
      }

      if (clubIds.length === 0 && teamIds.length === 0) return false;

      // Pro Access Logic: Club Pro → all teams inherit; Free club → check team subscription

      // First check club subscriptions
      if (clubIds.length > 0) {
        const { data: clubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", clubIds);

        const hasClubPro = clubSubs?.some(s =>
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        );

        if (hasClubPro) return true;
      }

      // If no club Pro, check team-level subscriptions (for teams in free clubs)
      if (teamIds.length > 0) {
        const { data: teamSubs } = await supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", teamIds);

        const hasTeamPro = teamSubs?.some(s =>
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        );

        if (hasTeamPro) return true;
      }

      return false;
    },
    enabled: !!user && !!userRoles,
  });

  // Only show lock after both queries have loaded to prevent flash
  const isLoadingAccess = !userRoles || hasProAccess === undefined;
  const showProLock = !isLoadingAccess && !hasProAccess && !isAppAdmin;

  // Lock native bottom inset to fixed values so iOS photo picker viewport changes can't shift nav
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

  const nativeInsetFloorPx = useMemo(() => {
    if (!isNativeIOS) return MIN_NATIVE_BOTTOM_INSET_PX;
    if (typeof window === "undefined") return IOS_PHONE_BOTTOM_INSET_PX;

    const shortestScreenEdgePx = Math.min(
      window.screen?.width ?? window.innerWidth,
      window.screen?.height ?? window.innerHeight,
    );

    return shortestScreenEdgePx <= 430 ? IOS_PHONE_BOTTOM_INSET_PX : MIN_NATIVE_BOTTOM_INSET_PX;
  }, [isNativeIOS]);

  const clampNativeInsetPx = useCallback(
    (insetPx: number) => Math.min(MAX_NATIVE_BOTTOM_INSET_PX, Math.max(nativeInsetFloorPx, insetPx)),
    [nativeInsetFloorPx],
  );

  const [nativeSafeInsetPx, setNativeSafeInsetPx] = useState(() => {
    if (typeof document === "undefined") return nativeInsetFloorPx;

    const existingInsetPx = Number.parseFloat(
      document.documentElement.style.getPropertyValue("--bottom-nav-safe-inset-px") ||
        document.documentElement.style.getPropertyValue("--bottom-nav-safe-inset") ||
        "",
    );

    const measuredInsetPx = readSafeAreaInsetBottomPx();
    const bootstrapInsetPx = Math.max(Number.isFinite(existingInsetPx) ? existingInsetPx : 0, measuredInsetPx);

    return clampNativeInsetPx(bootstrapInsetPx || nativeInsetFloorPx);
  });

  const [navInteractionLocked, setNavInteractionLocked] = useState(false);
  const [visualViewportOffsetTopPx, setVisualViewportOffsetTopPx] = useState(0);
  const navGuardTimeoutRef = useRef<number | null>(null);
  const insetSyncTimeoutsRef = useRef<number[]>([]);
  const viewportSyncTimeoutsRef = useRef<number[]>([]);

  const clearInsetSyncTimeouts = useCallback(() => {
    if (typeof window === "undefined") return;

    insetSyncTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    insetSyncTimeoutsRef.current = [];
  }, []);

  const clearViewportSyncTimeouts = useCallback(() => {
    if (typeof window === "undefined") return;

    viewportSyncTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    viewportSyncTimeoutsRef.current = [];
  }, []);

  const applyMeasuredInset = useCallback(
    (measuredInset: number, options: { allowDecrease?: boolean } = {}) => {
      const stabilizedInset = clampNativeInsetPx(measuredInset);

      setNativeSafeInsetPx((previousInset) => {
        if (options.allowDecrease) return stabilizedInset;
        return stabilizedInset < previousInset ? previousInset : stabilizedInset;
      });
    },
    [clampNativeInsetPx],
  );

  const measureNativeSafeInset = useCallback(
    (options: { allowDecrease?: boolean } = {}) => {
      if (!isNativeIOS) return;
      applyMeasuredInset(readSafeAreaInsetBottomPx(), options);
    },
    [applyMeasuredInset, isNativeIOS],
  );

  const scheduleInsetSync = useCallback(
    (delaysMs: readonly number[], options: { allowDecrease?: boolean } = {}) => {
      if (typeof window === "undefined") return;

      clearInsetSyncTimeouts();
      insetSyncTimeoutsRef.current = delaysMs.map((delayMs) =>
        window.setTimeout(() => {
          measureNativeSafeInset(options);
        }, delayMs),
      );
    },
    [clearInsetSyncTimeouts, measureNativeSafeInset],
  );

  const syncVisualViewportOffset = useCallback(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      setVisualViewportOffsetTopPx(0);
      return;
    }

    const keyboardLikelyOpen = visualViewport.height < window.innerHeight - KEYBOARD_HEIGHT_THRESHOLD_PX;
    const canCompensate = !keyboardLikelyOpen && visualViewport.scale === 1;

    const nextOffsetPx = canCompensate
      ? Math.min(
          MAX_VIEWPORT_OFFSET_COMPENSATION_PX,
          Math.max(0, Math.round(visualViewport.offsetTop || 0)),
        )
      : 0;

    setVisualViewportOffsetTopPx((previousOffsetPx) =>
      Math.abs(previousOffsetPx - nextOffsetPx) <= 1 ? previousOffsetPx : nextOffsetPx,
    );
  }, [isNativeIOS]);

  const scheduleVisualViewportSync = useCallback(
    (delaysMs: readonly number[] = VIEWPORT_OFFSET_SYNC_DELAYS_MS) => {
      if (typeof window === "undefined") return;

      clearViewportSyncTimeouts();
      viewportSyncTimeoutsRef.current = delaysMs.map((delayMs) =>
        window.setTimeout(() => {
          syncVisualViewportOffset();
        }, delayMs),
      );
    },
    [clearViewportSyncTimeouts, syncVisualViewportOffset],
  );

  const lockNavInteractions = useCallback((durationMs = DEFAULT_NAV_GUARD_MS) => {
    if (typeof window === "undefined") return;

    if (navGuardTimeoutRef.current !== null) {
      window.clearTimeout(navGuardTimeoutRef.current);
    }

    setNavInteractionLocked(true);
    navGuardTimeoutRef.current = window.setTimeout(() => {
      setNavInteractionLocked(false);
      navGuardTimeoutRef.current = null;
    }, Math.max(250, durationMs));
  }, []);

  // Measure safe area inset ONCE on mount + orientation changes only.
  // After initial measurement, the inset is frozen — no picker/keyboard/route event can alter it.
  const insetFrozenRef = useRef(false);

  useEffect(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const handleOrientationChange = () => {
      insetFrozenRef.current = false;
      measureNativeSafeInset({ allowDecrease: true });
      scheduleInsetSync([240, 560], { allowDecrease: true });
      scheduleVisualViewportSync();
      lockNavInteractions(DEFAULT_NAV_GUARD_MS);
      window.setTimeout(() => {
        insetFrozenRef.current = true;
      }, 700);
    };

    window.addEventListener("orientationchange", handleOrientationChange);

    let freezeTimeout: number | null = null;
    if (!insetFrozenRef.current) {
      measureNativeSafeInset();
      freezeTimeout = window.setTimeout(() => {
        insetFrozenRef.current = true;
      }, 500);
    }

    return () => {
      if (freezeTimeout !== null) {
        window.clearTimeout(freezeTimeout);
      }
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, [isNativeIOS, lockNavInteractions, measureNativeSafeInset, scheduleInsetSync, scheduleVisualViewportSync]);

  useEffect(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const handleViewportMutation = () => {
      syncVisualViewportOffset();
    };

    syncVisualViewportOffset();
    window.visualViewport?.addEventListener("resize", handleViewportMutation);
    window.visualViewport?.addEventListener("scroll", handleViewportMutation);
    window.addEventListener("resize", handleViewportMutation);

    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportMutation);
      window.visualViewport?.removeEventListener("scroll", handleViewportMutation);
      window.removeEventListener("resize", handleViewportMutation);
    };
  }, [isNativeIOS, syncVisualViewportOffset]);

  // Listen for iOS nav guard events only (interaction locking).
  // Layout reset events NO LONGER trigger inset re-measurement — inset remains frozen.
  useEffect(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const handleLayoutReset = () => {
      lockNavInteractions(1200);
      scheduleVisualViewportSync();
    };

    const handleNavGuard = (event: Event) => {
      const customEvent = event as CustomEvent<{ durationMs?: number }>;
      lockNavInteractions(customEvent.detail?.durationMs ?? DEFAULT_NAV_GUARD_MS);
      scheduleVisualViewportSync();
    };

    window.addEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
    window.addEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);

    return () => {
      window.removeEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
      window.removeEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);
    };
  }, [isNativeIOS, lockNavInteractions, scheduleVisualViewportSync]);

  // On route change, only lock interactions briefly — do NOT re-measure inset.
  useEffect(() => {
    if (!isNativeIOS) return;
    lockNavInteractions(700);
    scheduleVisualViewportSync();
  }, [isNativeIOS, location.pathname, lockNavInteractions, scheduleVisualViewportSync]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardTimeoutRef.current !== null) {
        window.clearTimeout(navGuardTimeoutRef.current);
      }
      clearInsetSyncTimeouts();
      clearViewportSyncTimeouts();
    };
  }, [clearInsetSyncTimeouts, clearViewportSyncTimeouts]);

  const nativeInsetFloor = `${nativeSafeInsetPx}px`;
  const navBottomInset = isNativeIOS
    ? `${nativeSafeInsetPx}px`
    : isAndroidNative || isIOSEnvironment
      ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
      : "env(safe-area-inset-bottom, 0px)";

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.style.setProperty("--bottom-nav-safe-inset", navBottomInset);
    root.style.setProperty("--bottom-nav-safe-inset-px", nativeInsetFloor);
    root.style.setProperty("--bottom-nav-offset", `calc(4rem + ${navBottomInset})`);
  }, [navBottomInset, nativeInsetFloor]);

  const navViewportCompensationTransform =
    isNativeIOS && visualViewportOffsetTopPx > 0
      ? `translateY(-${visualViewportOffsetTopPx}px)`
      : undefined;

  return (
    <>
      {/* Solid background filler to prevent content showing through safe area below nav */}
      {isNativePlatform && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none"
          style={{
            height: `calc(4rem + ${navBottomInset} + 1rem)`,
            transform: navViewportCompensationTransform,
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
          transform: navViewportCompensationTransform,
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
              className={({ isActive }) => cn(
                "flex flex-col items-center justify-center flex-1 py-2 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              {({ isActive }) => (
                <span aria-current={isActive ? "page" : undefined} className="flex flex-col items-center">
                  <div className={cn(
                    "p-1.5 rounded-xl transition-all relative",
                    isActive && "bg-primary/10"
                  )}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {label === "Messages" && unreadMessagesCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 animate-pulse-glow shadow-sm" aria-label={`${unreadMessagesCount} unread messages`}>
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
