import { useState } from "react";
import { Bell, Flame, User, LogOut, Users, Trash2, Loader2, Moon, Sun, Check, HelpCircle, Building2, Lock, UserCog } from "lucide-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwipeableDropdownContent } from "@/components/ui/swipeable-dropdown-content";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ClubThemeToggle } from "@/components/ClubThemeToggle";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DemoLoginSection } from "@/components/DemoLoginSection";
import igniteIcon from "@/assets/ignite-icon.png";
import igniteIconLight from "@/assets/ignite-icon-light.png";
import { NotificationIcon } from "@/components/NotificationIcon";

// Helper to pick the best color from palette based on background contrast
function getBestContrastColor(
  primary: { h: number; s: number; l: number } | null | undefined,
  secondary: { h: number; s: number; l: number } | null | undefined,
  accent: { h: number; s: number; l: number } | null | undefined,
  isDark: boolean
): string | undefined {
  const bgLightness = isDark ? 6 : 96;
  const minContrast = 40;
  
  const getContrast = (color: { h: number; s: number; l: number } | null | undefined) => 
    color ? Math.abs(color.l - bgLightness) : 0;
  
  const toHsl = (color: { h: number; s: number; l: number }) => 
    `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
  
  // Check primary first
  if (primary && getContrast(primary) >= minContrast) {
    return toHsl(primary);
  }
  
  // Try secondary
  if (secondary && getContrast(secondary) >= minContrast) {
    return toHsl(secondary);
  }
  
  // Try accent
  if (accent && getContrast(accent) >= minContrast) {
    return toHsl(accent);
  }
  
  // Fallback to primary anyway if nothing else works
  if (primary) return toHsl(primary);
  
  return undefined;
}

function LogoClubThemeDropdown() {
  const { availableClubThemes, activeClubTheme, setActiveClubTheme } = useClubTheme();
  // Read theme from localStorage directly to prevent hydration flash
  const storedTheme = typeof window !== 'undefined' ? localStorage.getItem('app-theme') : 'light';
  const defaultLogo = storedTheme === "dark" ? igniteIcon : igniteIconLight;
  const { user } = useAuth();
  // Fetch ALL user clubs (including non-Pro) to show with lock
  const { data: allUserClubs = [] } = useQuery({
    queryKey: ["all-user-clubs-for-theme", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get club IDs from user roles
      const { data: clubRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);

      const clubIds = [...new Set((clubRoles || []).map(r => r.club_id).filter(Boolean))];

      // Also get clubs from team roles
      const { data: teamRoles } = await supabase
        .from("user_roles")
        .select("team_id, teams!inner(club_id)")
        .eq("user_id", user.id)
        .not("team_id", "is", null);

      if (teamRoles) {
        teamRoles.forEach(r => {
          const teamClubId = (r.teams as any)?.club_id;
          if (teamClubId && !clubIds.includes(teamClubId)) {
            clubIds.push(teamClubId);
          }
        });
      }

      if (!clubIds.length) return [];

      // Fetch clubs with subscription info
      const { data: clubs } = await supabase
        .from("clubs")
        .select(`
          id,
          name,
          logo_url,
          is_pro,
          theme_primary_h,
          theme_primary_s,
          theme_primary_l,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds);

      if (!clubs) return [];

      return clubs.map(club => {
        const sub = (club.club_subscriptions as any)?.[0];
        const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date());
        const hasPro = club.is_pro || hasProFromSub;
        const hasTheme = club.theme_primary_h !== null;
        
        return {
          clubId: club.id,
          clubName: club.name,
          logoUrl: club.logo_url,
          hasPro,
          hasTheme,
          isSelectable: hasPro && hasTheme,
        };
      });
    },
    enabled: !!user?.id,
  });

  // Non-Pro clubs that should show with lock (exclude Pro clubs without themes - they just shouldn't appear)
  const lockedClubs = allUserClubs.filter(c => !c.isSelectable && !c.hasPro);

  return (
    <DropdownMenuContent align="start" className="w-56">
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">Club Themes</p>
        <p className="text-xs text-muted-foreground">Apply your club's colors</p>
      </div>
      <DropdownMenuSeparator />
      
      {/* Default theme option */}
      <DropdownMenuItem 
        onClick={() => setActiveClubTheme(null)}
        className="flex items-center gap-3 py-2"
      >
        <img 
          src={defaultLogo} 
          alt="Ignite" 
          className="h-8 w-8 rounded-lg object-cover"
        />
        <div className="flex-1">
          <p className="text-sm font-medium">Default</p>
          <p className="text-xs text-muted-foreground">Ignite emerald</p>
        </div>
        {!activeClubTheme && <Check className="h-4 w-4 text-primary" />}
      </DropdownMenuItem>
      
      {availableClubThemes.length > 0 && <DropdownMenuSeparator />}
      
      {/* Pro club themes */}
      {availableClubThemes.map((theme) => (
        <DropdownMenuItem
          key={theme.clubId}
          onClick={() => setActiveClubTheme(theme.clubId)}
          className="flex items-center gap-3 py-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={theme.logoUrl || undefined} />
            <AvatarFallback 
              className="text-xs"
              style={{
                backgroundColor: theme.primary 
                  ? `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)`
                  : undefined,
                color: theme.primary && theme.primary.l > 50 ? '#1a1a1a' : '#fafafa',
              }}
            >
              {theme.clubName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{theme.clubName}</p>
            {theme.primary && (
              <div className="flex gap-1 mt-0.5">
                <div 
                  className="h-3 w-3 rounded-full border border-border"
                  style={{ backgroundColor: `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)` }}
                />
                {theme.secondary && (
                  <div 
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: `hsl(${theme.secondary.h}, ${theme.secondary.s}%, ${theme.secondary.l}%)` }}
                  />
                )}
                {theme.accent && (
                  <div 
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: `hsl(${theme.accent.h}, ${theme.accent.s}%, ${theme.accent.l}%)` }}
                  />
                )}
              </div>
            )}
          </div>
          {activeClubTheme === theme.clubId && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}

      {/* Locked clubs (non-Pro) */}
      {lockedClubs.length > 0 && (availableClubThemes.length > 0 || true) && <DropdownMenuSeparator />}
      {lockedClubs.map((club) => (
        <DropdownMenuItem
          key={club.clubId}
          disabled
          className="flex items-center gap-3 py-2 opacity-60 cursor-not-allowed"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={club.logoUrl || undefined} />
            <AvatarFallback className="text-xs bg-muted text-muted-foreground">
              {club.clubName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{club.clubName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Lock className="h-3 w-3" />
              <span className="text-xs">Pro only</span>
            </div>
          </div>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, unreadCount, user } = useAuth();
  const { activeThemeData, activeClubTheme } = useClubTheme();
  const { setTheme, theme, resolvedTheme } = useTheme();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [demoLoginOpen, setDemoLoginOpen] = useState(false);
  
  // CRITICAL: Read theme from DOM class FIRST, then localStorage
  // During Google OAuth return, useAuth updates DOM class synchronously when profile is fetched,
  // but localStorage and next-themes may still have stale values from the previous user.
  // The DOM class is the authoritative source after auth updates it.
  const getEffectiveTheme = (): 'light' | 'dark' => {
    if (typeof window !== 'undefined') {
      // First check DOM class - this is updated synchronously by useAuth on fresh login
      const isDarkClass = document.documentElement.classList.contains('dark');
      if (isDarkClass) return 'dark';
      if (document.documentElement.classList.contains('light')) return 'light';
      
      // Fallback to localStorage
      const stored = localStorage.getItem('app-theme');
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
    }
    return 'light';
  };
  
  // Use resolvedTheme after hydration, fall back to DOM/localStorage on initial render
  // CRITICAL: During OAuth, resolvedTheme may be stale - prefer getEffectiveTheme which reads DOM
  const effectiveTheme = resolvedTheme ?? getEffectiveTheme();

  // Check if user is app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Show club logo if theme is active and showLogoInHeader is enabled
  const showClubLogo = activeThemeData?.showLogoInHeader && activeThemeData?.logoUrl;
  
  // CRITICAL: Only show club theme elements when theme is fully ready
  // During Google OAuth return, there's a brief moment where activeThemeData may have
  // stale values while the auth session is being established. Wait for isThemeReady
  // to prevent incorrect contrast colors during this transition.
  const { isThemeReady } = useClubTheme();
  const shouldShowClubTheming = isThemeReady && activeThemeData;

  // Parse club name to split into main name and suffix (e.g., "Bridgewater Soccer Club" -> ["Bridgewater", "Soccer Club"])
  const parseClubName = (name: string): { mainName: string; suffix: string } => {
    const suffixes = [
      'Soccer Club', 'Football Club', 'Cricket Club', 'Basketball Club', 'Tennis Club',
      'Rugby Club', 'Hockey Club', 'Netball Club', 'Volleyball Club', 'Baseball Club',
      'Swimming Club', 'Athletics Club', 'Golf Club', 'Rowing Club', 'Lacrosse Club',
      'SC', 'FC', 'CC', 'BC', 'TC', 'RC', 'HC', 'NC', 'AFC', 'United', 'City', 'Town'
    ];
    
    for (const suffix of suffixes) {
      if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
        const mainName = name.slice(0, -suffix.length).trim();
        if (mainName) {
          return { mainName, suffix };
        }
      }
    }
    
    // No suffix found - just use the full name
    return { mainName: name, suffix: 'Club' };
  };

  const clubNameParts = activeThemeData ? parseClubName(activeThemeData.clubName) : null;

  const clearAllNotifications = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      // First mark all unread as read
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      // Then delete all notifications
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      setNotificationsOpen(false);
    },
  });

  const { data: recentNotifications = [] } = useQuery({
    queryKey: ["recent-notifications", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("id, message, type, created_at, is_read, related_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  const handleNotificationClick = async (notification: typeof recentNotifications[0]) => {
    // Mark as read first
    if (!notification.is_read) {
      markAsRead.mutate(notification.id);
    }

    const relatedId = notification.related_id;
    if (!relatedId) {
      navigate("/notifications");
      return;
    }

    switch (notification.type) {
      case "team_message":
      case "message_reply":
      case "message_reaction":
      case "message_mention":
        const { data: teamMessage } = await supabase
          .from("team_messages")
          .select("team_id")
          .eq("id", relatedId)
          .single();
        if (teamMessage?.team_id) {
          navigate(`/messages/${teamMessage.team_id}?message=${relatedId}`);
          return;
        }
        const { data: clubMsgForReaction } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMsgForReaction?.club_id) {
          navigate(`/messages/club/${clubMsgForReaction.club_id}?message=${relatedId}`);
          return;
        }
        const { data: groupMsgForReaction } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMsgForReaction?.group_id) {
          navigate(`/groups/${groupMsgForReaction.group_id}?message=${relatedId}`);
          return;
        }
        const { data: broadcastMsg } = await supabase
          .from("broadcast_messages")
          .select("id")
          .eq("id", relatedId)
          .single();
        if (broadcastMsg) {
          navigate(`/messages/broadcast?message=${relatedId}`);
          return;
        }
        break;
      case "club_message":
        const { data: clubMessage } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMessage?.club_id) {
          navigate(`/messages/club/${clubMessage.club_id}?message=${relatedId}`);
          return;
        }
        break;
      case "group_message":
        const { data: groupMessage } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMessage?.group_id) {
          navigate(`/groups/${groupMessage.group_id}?message=${relatedId}`);
          return;
        }
        break;
      case "broadcast":
        navigate(`/messages/broadcast?message=${relatedId}`);
        return;
      case "event_invite":
      case "event_cancelled":
      case "event_reminder":
      case "duty_assigned":
        navigate(`/events/${relatedId}`);
        return;
      case "photo_comment":
      case "photo_uploaded":
      case "photo_reaction":
        navigate(`/media?photo=${relatedId}`);
        return;
      case "comment_reaction":
      case "comment_reply":
        if (notification.type === "comment_reply") {
          navigate(`/media?photo=${relatedId}`);
        } else {
          const { data: commentData } = await supabase
            .from("photo_comments")
            .select("photo_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (commentData?.photo_id) {
            navigate(`/media?photo=${commentData.photo_id}`);
            return;
          }
          navigate("/media");
        }
        return;
      case "join_request":
      case "join_request_approved":
      case "join_request_denied":
      case "join_request_processed":
      case "role_assigned":
        navigate("/roles");
        return;
      case "rsvp":
        navigate(`/events/${relatedId}`);
        return;
    }

    navigate("/notifications");
  };

  // Render notification icon using centralized component
  const renderNotificationIcon = (type: string) => (
    <NotificationIcon type={type} mode="emoji" />
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-lg safe-area-top">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
              {shouldShowClubTheming ? (
                <>
                  {showClubLogo ? (
                    <div className="relative">
                      <img 
                        src={activeThemeData.logoUrl!} 
                        alt={activeThemeData.clubName}
                        className="h-8 w-auto max-w-[32px] object-contain"
                      />
                      <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full shadow-sm" style={{ backgroundColor: 'hsl(160, 84%, 39%)' }}>
                        <Flame className="h-2.5 w-2.5" style={{ color: 'white' }} />
                      </div>
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-primary">
                      <Flame className="h-5 w-5 text-primary-foreground" />
                    </div>
                  )}
                  {activeThemeData.showNameInHeader && !activeThemeData.logoOnlyMode && clubNameParts?.mainName && (
                    <div className="flex flex-col leading-tight items-start">
                      <div className="flex items-center gap-1.5">
                      <span 
                          className="font-bold text-lg truncate max-w-[140px]"
                          style={{ 
                            color: getBestContrastColor(
                              effectiveTheme === 'dark' ? (activeThemeData?.darkPrimary || activeThemeData?.primary) : activeThemeData?.primary,
                              effectiveTheme === 'dark' ? (activeThemeData?.darkSecondary || activeThemeData?.secondary) : activeThemeData?.secondary,
                              effectiveTheme === 'dark' ? (activeThemeData?.darkAccent || activeThemeData?.accent) : activeThemeData?.accent,
                              effectiveTheme === 'dark'
                            )
                          }}
                        >
                          {clubNameParts.mainName}
                        </span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase tracking-wide">Beta</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground -mt-1 text-left">{clubNameParts.suffix}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="p-1.5 rounded-lg bg-primary">
                    <Flame className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="flex flex-col leading-tight items-start">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-lg text-gradient-emerald">Ignite</span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase tracking-wide">Beta</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground -mt-1 text-left">Club HQ</span>
                  </div>
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <LogoClubThemeDropdown />
        </DropdownMenu>

        <div className="flex items-center gap-4">
          <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-destructive-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <SwipeableDropdownContent 
              className="w-80 bg-popover" 
              align="end"
              onSwipeClose={() => setNotificationsOpen(false)}
            >
              <div className="flex items-center justify-between p-3">
                <p className="text-sm font-semibold">Notifications</p>
                <div className="flex items-center gap-2">
                  {recentNotifications.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clearAllNotifications.mutate();
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
              <DropdownMenuSeparator />
              <ScrollArea className="max-h-[350px]">
                {recentNotifications.length === 0 ? (
                  <div className="py-6 px-4 text-center text-sm text-muted-foreground">
                    No notifications yet
                  </div>
                ) : (
                  recentNotifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className="flex items-start gap-3 py-3 px-3 cursor-pointer min-h-[60px]"
                      onSelect={(e) => {
                        e.preventDefault();
                        setNotificationsOpen(false);
                        handleNotificationClick(notification);
                      }}
                    >
                      {renderNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm line-clamp-2 ${!notification.is_read ? "font-medium" : ""}`}>
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0 mt-1.5" />
                      )}
                    </DropdownMenuItem>
                  ))
                )}
              </ScrollArea>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onSelect={(e) => { e.preventDefault(); setNotificationsOpen(false); navigate("/notifications"); }}
                className="justify-center text-primary py-3 px-3"
              >
                <span className="text-sm font-medium">View all notifications</span>
              </DropdownMenuItem>
            </SwipeableDropdownContent>
          </DropdownMenu>

          <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full p-0">
                <Avatar className="h-8 w-8 border-2 border-primary/20">
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    {profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <SwipeableDropdownContent 
              className="w-64 bg-popover" 
              align="end"
              onSwipeClose={() => setProfileOpen(false)}
            >
              <div className="flex items-center gap-3 p-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-medium">{profile?.display_name || "User"}</p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); navigate("/profile"); }} className="py-3 px-3">
                <User className="mr-3 h-5 w-5" />
                <span className="text-sm">My Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { 
                e.preventDefault(); 
                setProfileOpen(false); 
                // In club mode, go directly to the club detail page
                if (activeClubTheme) {
                  navigate(`/clubs/${activeClubTheme}`);
                } else {
                  navigate("/clubs");
                }
              }} className="py-3 px-3">
                <Building2 className="mr-3 h-5 w-5" />
                <span className="text-sm">My Clubs and Teams</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); navigate("/children"); }} className="py-3 px-3">
                <Users className="mr-3 h-5 w-5" />
                <span className="text-sm">My Children</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); setFeedbackOpen(true); }} className="py-3 px-3">
                <HelpCircle className="mr-3 h-5 w-5" />
                <span className="text-sm">Send Feedback</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onSelect={(e) => {
                  e.preventDefault();
                  setProfileOpen(false);
                  setTheme(theme === "dark" ? "light" : "dark");
                }}
                className="py-3 px-3"
              >
                {theme === "dark" ? (
                  <Sun className="mr-3 h-5 w-5" />
                ) : (
                  <Moon className="mr-3 h-5 w-5" />
                )}
                <span className="text-sm">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </DropdownMenuItem>
              {isAppAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onSelect={(e) => {
                      e.preventDefault();
                      setProfileOpen(false);
                      setDemoLoginOpen(true);
                    }}
                    className="py-3 px-3"
                  >
                    <UserCog className="mr-3 h-5 w-5" />
                    <span className="text-sm">Demo Accounts</span>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onSelect={(e) => {
                  e.preventDefault();
                  if (isSigningOut) return;
                  setIsSigningOut(true);
                  supabase.auth.signOut({ scope: 'local' }).finally(() => {
                    setIsSigningOut(false);
                    setProfileOpen(false);
                    navigate("/auth");
                  });
                }}
                className="text-destructive focus:text-destructive py-3 px-3"
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                ) : (
                  <LogOut className="mr-3 h-5 w-5" />
                )}
                <span className="text-sm">{isSigningOut ? "Signing out..." : "Sign Out"}</span>
              </DropdownMenuItem>
            </SwipeableDropdownContent>
          </DropdownMenu>
          
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
          {isAppAdmin && (
            <DemoLoginSection open={demoLoginOpen} onOpenChange={setDemoLoginOpen} />
          )}
        </div>
      </div>
    </header>
  );
}