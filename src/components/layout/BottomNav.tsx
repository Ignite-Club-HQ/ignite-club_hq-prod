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
  const navGuardTimeoutRef = useRef<number | null>(null);
  const insetSyncTimeoutsRef = useRef<number[]>([]);
  const navGuardSettleTimeoutRef = useRef<number | null>(null);

  const clearInsetSyncTimeouts = useCallback(() => {
    if (typeof window === "undefined") return;
    insetSyncTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    insetSyncTimeoutsRef.current = [];
  }, []);

  const clearNavGuardSettleTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (navGuardSettleTimeoutRef.current !== null) {
      window.clearTimeout(navGuardSettleTimeoutRef.current);
      navGuardSettleTimeoutRef.current = null;
    }
  }, []);

  const applyMeasuredInset = useCallback(
    (measuredInset: number, options: { allowDecrease?: boolean } = {}) => {
      const stabilizedInset = clampNativeInsetPx(measuredInset);
      setNativeSafeInsetPx((prev) => {
        if (options.allowDecrease) return stabilizedInset;
        return stabilizedInset < prev ? prev : stabilizedInset;
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

  const settleInflatedInset = useCallback(() => {
    const stabilizedInset = clampNativeInsetPx(readSafeAreaInsetBottomPx());

    setNativeSafeInsetPx((prev) => {
      if (stabilizedInset < prev) return stabilizedInset;
      if (prev > nativeInsetFloorPx + 2 && stabilizedInset >= prev) return nativeInsetFloorPx;
      return prev;
    });
  }, [clampNativeInsetPx, nativeInsetFloorPx]);

  const scheduleInsetSync = useCallback(
    (delaysMs: readonly number[], options: { allowDecrease?: boolean } = {}) => {
      if (typeof window === "undefined") return;
      clearInsetSyncTimeouts();
      insetSyncTimeoutsRef.current = delaysMs.map((ms) =>
        window.setTimeout(() => measureNativeSafeInset(options), ms),
      );
    },
    [clearInsetSyncTimeouts, measureNativeSafeInset],
  );

  const lockNavInteractions = useCallback((durationMs = DEFAULT_NAV_GUARD_MS) => {
    if (typeof window === "undefined") return;
    if (navGuardTimeoutRef.current !== null) window.clearTimeout(navGuardTimeoutRef.current);
    setNavInteractionLocked(true);
    navGuardTimeoutRef.current = window.setTimeout(() => {
      setNavInteractionLocked(false);
      navGuardTimeoutRef.current = null;
    }, Math.max(250, durationMs));
  }, []);

  // Measure safe area inset ONCE on mount + orientation changes only.
  const insetFrozenRef = useRef(false);

  useEffect(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const handleOrientationChange = () => {
      insetFrozenRef.current = false;
      measureNativeSafeInset({ allowDecrease: true });
      scheduleInsetSync([240, 560], { allowDecrease: true });
      lockNavInteractions(DEFAULT_NAV_GUARD_MS);
      window.setTimeout(() => { insetFrozenRef.current = true; }, 700);
    };

    window.addEventListener("orientationchange", handleOrientationChange);

    let freezeTimeout: number | null = null;
    if (!insetFrozenRef.current) {
      measureNativeSafeInset();
      freezeTimeout = window.setTimeout(() => { insetFrozenRef.current = true; }, 500);
    }

    return () => {
      if (freezeTimeout !== null) window.clearTimeout(freezeTimeout);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, [isNativeIOS, lockNavInteractions, measureNativeSafeInset, scheduleInsetSync]);

  // Layout reset / nav guard events → only lock interactions
  useEffect(() => {
    if (!isNativeIOS || typeof window === "undefined") return;

    const handleLayoutReset = () => lockNavInteractions(1200);
    const handleNavGuard = (event: Event) => {
      const ce = event as CustomEvent<{ durationMs?: number }>;
      const duration = ce.detail?.durationMs ?? DEFAULT_NAV_GUARD_MS;
      lockNavInteractions(duration);

      // After iOS permission/photo-picker dismissal, safe-area values can stay
      // inflated for longer than 1.2s on first-run permission flows.
      const settleDelayMs = Math.max(1700, duration + 700);
      scheduleInsetSync([400, 800, 1200, settleDelayMs], { allowDecrease: true });

      clearNavGuardSettleTimeout();
      navGuardSettleTimeoutRef.current = window.setTimeout(() => {
        settleInflatedInset();
        navGuardSettleTimeoutRef.current = null;
      }, settleDelayMs + 250);
    };

    window.addEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
    window.addEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);
    return () => {
      window.removeEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
      window.removeEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);
      clearNavGuardSettleTimeout();
    };
  }, [
    isNativeIOS,
    clearNavGuardSettleTimeout,
    lockNavInteractions,
    scheduleInsetSync,
    settleInflatedInset,
  ]);

  // Route change → lock interactions briefly
  useEffect(() => {
    if (!isNativeIOS) return;
    lockNavInteractions(700);
  }, [isNativeIOS, location.pathname, lockNavInteractions]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardTimeoutRef.current !== null) {
        window.clearTimeout(navGuardTimeoutRef.current);
      }
      clearInsetSyncTimeouts();
    };
  }, [clearInsetSyncTimeouts]);

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

  // GPU layer promotion style — forces iOS to keep the nav on a dedicated
  // compositing layer so WKWebView viewport mutations can't "unstick" it.
  const gpuLayerStyle: React.CSSProperties = isNativeIOS
    ? { transform: "translate3d(0,0,0)", willChange: "transform", backfaceVisibility: "hidden" }
    : {};

  return (
    <>
      {isNativePlatform && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none"
          style={{
            height: `calc(4rem + ${navBottomInset} + 1rem)`,
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
