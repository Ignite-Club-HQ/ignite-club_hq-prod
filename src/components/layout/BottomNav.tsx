import { useMemo } from "react";
import { Home, Calendar, MessageCircle, Image, Lock } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";


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

  // Removed viewport compensation logic - it caused more issues than it solved.
  // The nav stays fixed at bottom:0 and iOS viewport shifts settle naturally.

  const navBottomInset = isAndroidNative || isIOSEnvironment
    ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
    : "env(safe-area-inset-bottom, 0px)";
  return (
    <>
      {/* Solid background filler to prevent content showing through safe area below nav */}
      {isNativePlatform && (
          <div
            className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none"
            style={{
              height: `calc(4rem + ${navBottomInset} + 1rem)`,
            }}
          />
        )}
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card backdrop-blur-lg"
          style={{
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