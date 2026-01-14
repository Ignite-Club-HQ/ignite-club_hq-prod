import { Home, Calendar, MessageCircle, Image, Lock } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { to: "/", icon: Home, label: "Home", requiresPro: false },
  { to: "/messages", icon: MessageCircle, label: "Messages", requiresPro: false },
  { to: "/events", icon: Calendar, label: "Events", requiresPro: false },
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

  const showProLock = !hasProAccess && !isAppAdmin;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-lg">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map(({ to, icon: Icon, label, requiresPro }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => cn(
              "flex flex-col items-center justify-center flex-1 py-2 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            {({ isActive }) => (
              <>
                <div className={cn(
                  "p-1.5 rounded-xl transition-all relative",
                  isActive && "bg-primary/10"
                )}>
                  <Icon className="h-5 w-5" />
                  {label === "Messages" && unreadMessagesCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                      {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
                    </span>
                  )}
                  {requiresPro && showProLock && (
                    <Lock className="h-3 w-3 text-muted-foreground absolute -top-1 -right-1" />
                  )}
                </div>
                <span className="text-[10px] font-medium mt-0.5">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}