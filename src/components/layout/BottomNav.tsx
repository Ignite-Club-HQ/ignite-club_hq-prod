import { useEffect, useMemo, useRef, useState } from "react";
import { Home, Calendar, MessageCircle, Image, Lock } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const IOS_LAYOUT_RESET_EVENT = "ignite:ios-layout-reset";
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
  "range",
  "color",
  "hidden",
]);

const navItems = [
  { to: "/", icon: Home, label: "Home", requiresPro: false },
  { to: "/messages", icon: MessageCircle, label: "Messages", requiresPro: false },
  { to: "/events", icon: Calendar, label: "Schedule", requiresPro: false },
  { to: "/media", icon: Image, label: "Media", requiresPro: true },
];

export function BottomNav() {
  const { unreadMessagesCount, user } = useAuth();

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
  const isAndroidNative = isNativePlatform && platform === "android";

  const isIOSEnvironment = useMemo(() => {
    if (typeof navigator === "undefined") return platform === "ios";
    const userAgent = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const iPadOSDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOSDesktopMode || platform === "ios";
  }, [platform]);

  const [iosViewportCompensation, setIosViewportCompensation] = useState(0);
  const baselineViewportRef = useRef<{ width: number; height: number } | null>(null);
  const keyboardVisibleRef = useRef(false);

  useEffect(() => {
    if (!isIOSEnvironment || typeof window === "undefined") {
      baselineViewportRef.current = null;
      setIosViewportCompensation(0);
      return;
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      baselineViewportRef.current = null;
      return;
    }

    let rafId = 0;
    const settleTimeouts: number[] = [];

    const clearSettleTimeouts = () => {
      settleTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      settleTimeouts.length = 0;
    };

    const updateCompensation = () => {
      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      const baseline = baselineViewportRef.current;

      if (!baseline || Math.abs(baseline.width - currentWidth) > 48) {
        baselineViewportRef.current = { width: currentWidth, height: currentHeight };
      } else if (currentHeight > baseline.height) {
        baseline.height = currentHeight;
        baseline.width = currentWidth;
      } else {
        baseline.width = currentWidth;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const inputType = activeElement instanceof HTMLInputElement
        ? activeElement.type.toLowerCase()
        : "";
      const isTextInput = activeElement instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(inputType);
      const isEditingField = Boolean(
        activeElement &&
          (activeElement.isContentEditable ||
            activeElement instanceof HTMLTextAreaElement ||
            activeElement instanceof HTMLSelectElement ||
            isTextInput)
      );

      const visualViewportBottom = visualViewport.height + visualViewport.offsetTop;
      const rawViewportGap = currentHeight - visualViewportBottom;
      const viewportDisplacement = Number.isFinite(rawViewportGap)
        ? Math.abs(rawViewportGap) > 1
          ? Math.abs(rawViewportGap)
          : 0
        : 0;
      const stableLayoutGap = Math.max(
        0,
        (baselineViewportRef.current?.height ?? currentHeight) - currentHeight
      );

      const viewportSuggestsKeyboard = isEditingField && (
        stableLayoutGap > 180 ||
        currentHeight - visualViewport.height > 180
      );
      const keyboardLikelyVisible = keyboardVisibleRef.current || viewportSuggestsKeyboard;

      // Keep default behavior only while keyboard is truly visible
      if (keyboardLikelyVisible) {
        setIosViewportCompensation(0);
        return;
      }

      const compensationGap = Math.min(160, Math.max(viewportDisplacement, stableLayoutGap));
      const nextCompensation = compensationGap > 0 ? -compensationGap : 0;

      setIosViewportCompensation((prev) =>
        Math.abs(prev - nextCompensation) < 1 ? prev : nextCompensation
      );
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(rafId);
      clearSettleTimeouts();

      rafId = requestAnimationFrame(() => {
        updateCompensation();

        [120, 280, 520].forEach((delay) => {
          const timeoutId = window.setTimeout(() => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(updateCompensation);
          }, delay);
          settleTimeouts.push(timeoutId);
        });
      });
    };

    const handleLayoutReset: EventListener = () => {
      scheduleUpdate();
    };

    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("orientationchange", scheduleUpdate);
    window.addEventListener("focus", scheduleUpdate, true);
    window.addEventListener("pageshow", scheduleUpdate);
    window.addEventListener("keyboardWillHide", scheduleUpdate);
    window.addEventListener("keyboardDidHide", scheduleUpdate);
    window.addEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
    document.addEventListener("visibilitychange", scheduleUpdate);

    scheduleUpdate();

    return () => {
      cancelAnimationFrame(rafId);
      clearSettleTimeouts();
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
      window.removeEventListener("focus", scheduleUpdate, true);
      window.removeEventListener("pageshow", scheduleUpdate);
      window.removeEventListener("keyboardWillHide", scheduleUpdate);
      window.removeEventListener("keyboardDidHide", scheduleUpdate);
      window.removeEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
      document.removeEventListener("visibilitychange", scheduleUpdate);
    };
  }, [isIOSEnvironment]);

  const navBottomInset = isAndroidNative || isIOSEnvironment
    ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
    : "env(safe-area-inset-bottom, 0px)";

  return (
    <>
      {/* Solid background filler to prevent content showing through safe area below nav */}
      {isNativePlatform && (
          <div
            className="fixed bottom-0 left-0 right-0 z-[49] bg-card"
            style={{
              bottom: `${iosViewportCompensation}px`,
              height: `calc(4rem + ${navBottomInset} + 1rem)`,
            }}
          />
        )}
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card backdrop-blur-lg"
          style={{
            bottom: `${iosViewportCompensation}px`,
            paddingBottom: navBottomInset,
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