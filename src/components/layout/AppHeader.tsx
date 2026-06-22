import { useState, useEffect } from "react";
import { LogoImage } from "@/components/ui/logo-image";
import { Bell, Flame, User, LogOut, Users, Trash2, Loader2, Moon, Sun, Check, Building2, Lock, UserCog, Settings, Folder, ChevronDown } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DemoLoginSection } from "@/components/DemoLoginSection";
import igniteIcon from "@/assets/ignite-icon.png";
import { NotificationIcon } from "@/components/NotificationIcon";
import { setPendingChatJump, withChatJumpNonce } from "@/lib/pendingChatJump";

// Preload Ignite icon so it's instantly available when switching from club theme
const preloadedIgniteIcon = new Image();
preloadedIgniteIcon.src = igniteIcon;

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
  const defaultLogo = igniteIcon;
  const { user, signOut } = useAuth();
  // Fetch ALL user clubs (including non-Pro) to show with lock
  const { data: allUserClubs = [] } = useQuery({
    queryKey: ["all-user-clubs-for-theme-v2", user?.id],
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

      // Fetch clubs with subscription info (exclude soft-deleted clubs)
      const { data: clubs } = await supabase
        .from("clubs")
        .select(`
          id,
          name,
          logo_url,
          is_pro,
          kind,
          theme_primary_h,
          theme_primary_s,
          theme_primary_l,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds)
        .is("deleted_at", null)
        .neq("kind", "shell");


      if (!clubs) return [];

      const getClubPriority = (club: {
        isSelectable: boolean;
        hasPro: boolean;
        hasTheme: boolean;
      }) => (
        (club.isSelectable ? 4 : 0) +
        (club.hasPro ? 2 : 0) +
        (club.hasTheme ? 1 : 0)
      );

      const result = clubs.map(club => {
        const sub = (club.club_subscriptions as any)?.[0];
        const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date());
        const hasPro = club.is_pro || hasProFromSub;
        const hasTheme = club.theme_primary_h !== null;
        
        return {
          clubId: club.id,
          clubName: club.name.trim(),
          logoUrl: club.logo_url,
          hasPro,
          hasTheme,
          isSelectable: hasPro && hasTheme,
        };
      });

      const dedupedClubs = new Map<string, (typeof result)[number]>();
      result.forEach((club) => {
        const normalizedName = club.clubName.toLowerCase().replace(/\s+/g, " ").trim();
        const existing = dedupedClubs.get(normalizedName);
        if (!existing || getClubPriority(club) > getClubPriority(existing)) {
          dedupedClubs.set(normalizedName, club);
        }
      });

      return Array.from(dedupedClubs.values());
    },
    enabled: !!user?.id,
  });

  // Build a single, deduplicated list of every club the user belongs to.
  // Each club appears exactly once. Pro+themed clubs show swatches and are
  // selectable for branding; free clubs are still selectable (for content
  // filtering) but show a small lock + "Default theme" hint.
  const themeByClubId = new Map(availableClubThemes.map((t) => [t.clubId, t]));
  const themeByName = new Map(
    availableClubThemes.map((t) => [t.clubName.toLowerCase().replace(/\s+/g, " ").trim(), t]),
  );

  type MergedClub = {
    clubId: string;
    clubName: string;
    logoUrl: string | null;
    hasPro: boolean;
    theme: (typeof availableClubThemes)[number] | null;
  };

  const mergedMap = new Map<string, MergedClub>();
  allUserClubs.forEach((club) => {
    const normalized = club.clubName.toLowerCase().replace(/\s+/g, " ").trim();
    const theme = themeByClubId.get(club.clubId) ?? themeByName.get(normalized) ?? null;
    const existing = mergedMap.get(normalized);
    const next: MergedClub = {
      clubId: theme?.clubId ?? club.clubId,
      clubName: club.clubName,
      logoUrl: club.logoUrl,
      hasPro: club.hasPro,
      theme,
    };
    if (!existing) {
      mergedMap.set(normalized, next);
    } else {
      // Prefer the entry that has a theme / Pro
      const score = (c: MergedClub) => (c.theme ? 2 : 0) + (c.hasPro ? 1 : 0);
      if (score(next) > score(existing)) mergedMap.set(normalized, next);
    }
  });
  // Also include any availableClubThemes that somehow weren't in allUserClubs
  availableClubThemes.forEach((t) => {
    const normalized = t.clubName.toLowerCase().replace(/\s+/g, " ").trim();
    if (!mergedMap.has(normalized)) {
      mergedMap.set(normalized, {
        clubId: t.clubId,
        clubName: t.clubName,
        logoUrl: t.logoUrl,
        hasPro: true,
        theme: t,
      });
    }
  });

  const mergedClubs = Array.from(mergedMap.values()).sort((a, b) => {
    // Active first, then themed/Pro, then alphabetical
    if (a.clubId === activeClubTheme) return -1;
    if (b.clubId === activeClubTheme) return 1;
    const aw = (a.theme ? 2 : 0) + (a.hasPro ? 1 : 0);
    const bw = (b.theme ? 2 : 0) + (b.hasPro ? 1 : 0);
    if (aw !== bw) return bw - aw;
    return a.clubName.localeCompare(b.clubName);
  });

  // Pin the active club at the very top so the dropdown opens with the
  // current selection visible without scrolling.
  const sortedClubs = [...mergedClubs].sort((a, b) => {
    if (a.clubId === activeClubTheme && b.clubId !== activeClubTheme) return -1;
    if (b.clubId === activeClubTheme && a.clubId !== activeClubTheme) return 1;
    const aHas = a.theme ? 1 : 0;
    const bHas = b.theme ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return a.clubName.localeCompare(b.clubName);
  });

  const renderClubRow = (club: MergedClub) => {
    const theme = club.theme;
    const selected = activeClubTheme === club.clubId;
    const isFree = !theme;
    return (
      <DropdownMenuItem
        key={club.clubId}
        onClick={() => setActiveClubTheme(club.clubId)}
        className={
          "flex items-center gap-3 py-2 my-0.5 rounded-md " +
          (selected ? "bg-primary/15 ring-1 ring-primary/40 focus:bg-primary/20" : "")
        }
      >
        <Avatar className={"h-8 w-8 " + (selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "")}>
          {!isFree && <AvatarImage src={club.logoUrl || undefined} />}
          <AvatarFallback
            className="text-xs"
            style={{
              backgroundColor: !isFree && theme?.primary
                ? `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)`
                : undefined,
              color: !isFree && theme?.primary && theme.primary.l > 50 ? "#1a1a1a" : undefined,
            }}
          >
            {isFree ? (
              <img src={igniteIcon} alt="Ignite" className="h-full w-full object-contain" />
            ) : (
              club.clubName.charAt(0)
            )}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={"text-sm truncate " + (selected ? "font-semibold text-foreground" : "font-medium")}>
              {club.clubName}
            </p>
            {selected && (
              <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold uppercase tracking-wide">
                Current
              </span>
            )}
          </div>
          {isFree ? (
            <div className="flex items-center gap-1 mt-0.5 text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span className="text-[11px]">Default theme</span>
            </div>
          ) : theme?.primary ? (
            <div className="flex gap-1 mt-0.5">
              <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)` }} />
              {theme.secondary && (
                <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: `hsl(${theme.secondary.h}, ${theme.secondary.s}%, ${theme.secondary.l}%)` }} />
              )}
              {theme.accent && (
                <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: `hsl(${theme.accent.h}, ${theme.accent.s}%, ${theme.accent.l}%)` }} />
              )}
            </div>
          ) : null}
        </div>
        {selected && (
          <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Check className="h-3 w-3" strokeWidth={3} />
          </div>
        )}
      </DropdownMenuItem>
    );
  };

  const activeClub = sortedClubs.find((c) => c.clubId === activeClubTheme) || null;
  const otherClubs = sortedClubs.filter((c) => c.clubId !== activeClubTheme);

  return (
    <DropdownMenuContent align="start" className="w-72">
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">Switch club</p>
        <p className="text-xs text-muted-foreground">Tap a club to see its schedule, teams and news</p>
      </div>
      <DropdownMenuSeparator />

      {/* Active club pinned at top */}
      {activeClub && (
        <>
          <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Current club
          </p>
          {renderClubRow(activeClub)}
        </>
      )}

      {/* Other clubs */}
      {otherClubs.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your clubs
          </p>
          {otherClubs.map(renderClubRow)}
        </>
      )}

      {/* All Clubs — its own section so it's never confused with a club */}
      <DropdownMenuSeparator />
      <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        All Clubs
      </p>
      <DropdownMenuItem
        onClick={() => setActiveClubTheme(null)}
        className={
          "flex items-center gap-3 py-2 my-0.5 rounded-md " +
          (!activeClubTheme ? "bg-primary/15 ring-1 ring-primary/40 focus:bg-primary/20" : "")
        }
      >
        <img
          src={defaultLogo}
          alt="Ignite"
          className={
            "h-8 w-8 rounded-lg object-cover " +
            (!activeClubTheme ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "")
          }
        />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <p className={"text-sm " + (!activeClubTheme ? "font-semibold text-foreground" : "font-medium")}>All Clubs</p>
            {!activeClubTheme && (
              <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold uppercase tracking-wide">
                Current
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">See updates from all your clubs in one place</p>
        </div>
        {!activeClubTheme && (
          <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Check className="h-3 w-3" strokeWidth={3} />
          </div>
        )}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}


export function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, unreadCount: globalUnreadCount, user, clearUnreadCount, refreshUnreadCount, signOut } = useAuth();
  const { activeThemeData, activeClubTheme, activeClubFilter, availableClubThemes } = useClubTheme();
  const { setTheme, theme, resolvedTheme } = useTheme();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [demoLoginOpen, setDemoLoginOpen] = useState(false);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  
  // Handle theme toggle with save to profile
  const handleThemeToggle = async () => {
    const currentTheme = getEffectiveTheme();
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    
    console.log('[AppHeader] Theme toggle clicked, changing from', currentTheme, 'to', newTheme);
    
    // Apply to DOM immediately
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(newTheme);
    root.style.colorScheme = newTheme;
    localStorage.setItem('app-theme', newTheme);
    setTheme(newTheme); // Also update next-themes
    
    // Save to profile if logged in
    if (!user) {
      console.warn('[AppHeader] Cannot save theme - no user logged in');
      return;
    }
    
    if (isSavingTheme) {
      console.log('[AppHeader] Theme save already in progress');
      return;
    }
    
    console.log('[AppHeader] Saving theme to profile:', newTheme, 'for user:', user.id);
    setIsSavingTheme(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ theme_preference: newTheme })
        .eq('id', user.id);
      
      if (error) {
        console.error('[AppHeader] Failed to save theme preference:', error);
      } else {
        console.log('[AppHeader] Theme preference saved successfully:', newTheme);
      }
    } catch (err) {
      console.error('[AppHeader] Exception saving theme preference:', err);
    } finally {
      setIsSavingTheme(false);
    }
  };
  
  // CRITICAL: Read theme from DOM class FIRST, then localStorage, then next-themes
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
      
      // Fallback to next-themes resolved value
      if (resolvedTheme === 'dark' || resolvedTheme === 'light') {
        return resolvedTheme;
      }
      
      // Check system preference as last resort
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  };
  
  // CRITICAL: Always use DOM-based theme detection instead of next-themes
  // next-themes can return stale values from localStorage that haven't been updated yet
  // The DOM class is the authoritative source - it's updated synchronously by useAuth on fresh login
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(getEffectiveTheme);
  
  // Keep effectiveTheme in sync with DOM changes (from auth or manual toggles)
  useEffect(() => {
    const updateTheme = () => {
      const newTheme = getEffectiveTheme();
      setEffectiveTheme(newTheme);
    };
    
    // Watch for class changes on documentElement
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateTheme();
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    
    // Also sync immediately in case DOM changed before observer was set up
    updateTheme();
    
    return () => observer.disconnect();
  }, [resolvedTheme]);

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

  // Check if user has any vault-eligible club role (club_admin, league_admin, committee_member)
  const { data: hasVaultRole } = useQuery({
    queryKey: ["has-vault-role", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "committee_member"])
        .limit(1)
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
      // Match the same scope the dropdown renders: when a club filter is active,
      // include both club-scoped notifications AND global ones (club_id IS NULL)
      // — RSVP / invite / role-request notifications are intentionally stored
      // without a club_id and would otherwise remain after "Clear all".
      const scopeFilter = activeClubFilter
        ? `club_id.eq.${activeClubFilter},club_id.is.null`
        : null;

      // First mark all unread in scope as read
      let markQ = supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (scopeFilter) markQ = markQ.or(scopeFilter);
      await markQ;

      // Then delete notifications in the same scope
      let delQ = supabase
        .from("notifications")
        .delete()
        .eq("user_id", user.id);
      if (scopeFilter) delQ = delQ.or(scopeFilter);
      const { error } = await delQ;
      if (error) throw error;
    },
    onMutate: () => {
      // Optimistically clear the badge and dropdown immediately
      clearUnreadCount();
      queryClient.setQueriesData<unknown[]>({ queryKey: ["recent-notifications"] }, () => []);
      queryClient.setQueriesData<number>({ queryKey: ["club-unread-count"] }, () => 0);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
      setNotificationsOpen(false);
      // Force refresh to get accurate count from server
      setTimeout(() => refreshUnreadCount(), 300);
    },
  });

  const { data: recentNotifications = [], refetch: refetchRecentNotifications } = useQuery({
    queryKey: ["recent-notifications", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user?.id) return [];
      let q = supabase
        .from("notifications")
        .select("id, message, type, created_at, is_read, related_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      // Include notifications scoped to the active club AND global ones (club_id IS NULL),
      // since some types like join_request / team_invite / role_request are intentionally
      // stored without a club_id and would otherwise be hidden by an active club filter.
      if (activeClubFilter) q = q.or(`club_id.eq.${activeClubFilter},club_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 0,
  });

  // Per-club unread count (only when a club filter is active)
  const { data: clubUnreadCount = 0 } = useQuery({
    queryKey: ["club-unread-count", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user?.id || !activeClubFilter) return 0;
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .or(`club_id.eq.${activeClubFilter},club_id.is.null`)
        .eq("is_read", false);
      return count || 0;
    },
    enabled: !!user?.id && !!activeClubFilter,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Effective unread count: club-scoped when a filter is on, otherwise global
  const unreadCount = activeClubFilter ? clubUnreadCount : globalUnreadCount;

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
      queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
    },
  });

  const openDirectMessageNotification = async (relatedId: string, createdAt?: string | null) => {
    // Current rows store related_id as the exact direct_messages.id.
    const { data: directMsg } = await supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("id", relatedId)
      .maybeSingle();
    if (directMsg?.conversation_id) {
      setPendingChatJump("dm", directMsg.conversation_id, directMsg.id);
      navigate(withChatJumpNonce(`/messages/dm/${directMsg.conversation_id}?message=${directMsg.id}`));
      return true;
    }

    // Backward compatibility: older DM notifications stored related_id as the
    // conversation id. Resolve the message nearest the notification timestamp
    // from the other participant, not the latest message in the thread.
    const { data: conversation } = await supabase
      .from("direct_conversations")
      .select("id")
      .eq("id", relatedId)
      .maybeSingle();
    if (!conversation) return false;

    const clickedAt = createdAt ? new Date(createdAt) : null;
    const upperBound = clickedAt && !Number.isNaN(clickedAt.getTime())
      ? new Date(clickedAt.getTime() + 30_000).toISOString()
      : null;

    let messageQuery = supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("conversation_id", relatedId)
      .is("deleted_at", null);
    if (user?.id) messageQuery = messageQuery.neq("author_id", user.id);
    if (upperBound) messageQuery = messageQuery.lte("created_at", upperBound);
    const { data: nearestMsg } = await messageQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (nearestMsg?.id) {
      setPendingChatJump("dm", relatedId, nearestMsg.id);
      navigate(withChatJumpNonce(`/messages/dm/${relatedId}?message=${nearestMsg.id}`));
    } else {
      navigate(`/messages/dm/${relatedId}`);
    }
    return true;
  };

  const navigateWithFreshJump = (to: string) => navigate(withChatJumpNonce(to));

  const handleNotificationClick = async (notification: typeof recentNotifications[0]) => {
    try {
      console.log("[AppHeaderNotifTap] click", {
        notifId: notification.id,
        type: notification.type,
        related_id: notification.related_id,
        created_at: notification.created_at,
        is_read: notification.is_read,
      });
      // Mark as read first - use mutateAsync to ensure it completes before navigation
      if (!notification.is_read) {
        await markAsRead.mutateAsync(notification.id);
      }

      const relatedId = notification.related_id;
      if (!relatedId) {
        navigate("/notifications");
        return;
      }

      switch (notification.type) {
        case "message_reaction": {
          // Current trigger stores the reacted message id in related_id. Resolve
          // which chat container that message belongs to and deep-link with
          // ?message= so the chat page scrolls to it.
          const { data: tMsg } = await supabase.from("team_messages").select("team_id").eq("id", relatedId).maybeSingle();
          if (tMsg?.team_id) { navigateWithFreshJump(`/messages/${tMsg.team_id}?message=${relatedId}`); return; }
          const { data: cMsg } = await supabase.from("club_messages").select("club_id").eq("id", relatedId).maybeSingle();
          if (cMsg?.club_id) { navigateWithFreshJump(`/messages/club/${cMsg.club_id}?message=${relatedId}`); return; }
          const { data: gMsg } = await supabase.from("group_messages").select("group_id").eq("id", relatedId).maybeSingle();
          if (gMsg?.group_id) { navigateWithFreshJump(`/groups/${gMsg.group_id}?message=${relatedId}`); return; }
          const { data: dMsg } = await supabase.from("direct_messages").select("conversation_id").eq("id", relatedId).maybeSingle();
          if (dMsg?.conversation_id) { setPendingChatJump("dm", dMsg.conversation_id, relatedId); navigateWithFreshJump(`/messages/dm/${dMsg.conversation_id}?message=${relatedId}`); return; }
          const { data: bMsg } = await supabase.from("broadcast_messages").select("id").eq("id", relatedId).maybeSingle();
          if (bMsg) { navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`); return; }
          // Backward-compat: very old rows stored container_id as related_id.
          const { data: teamCheck } = await supabase.from("teams").select("id").eq("id", relatedId).maybeSingle();
          if (teamCheck) { navigate(`/messages/${relatedId}`); return; }
          const { data: clubCheck } = await supabase.from("clubs").select("id").eq("id", relatedId).maybeSingle();
          if (clubCheck) { navigate(`/messages/club/${relatedId}`); return; }
          const { data: groupCheck } = await supabase.from("chat_groups").select("id").eq("id", relatedId).maybeSingle();
          if (groupCheck) { navigate(`/groups/${relatedId}`); return; }
          const { data: convCheck } = await supabase.from("direct_conversations").select("id").eq("id", relatedId).maybeSingle();
          if (convCheck) { navigate(`/messages/dm/${relatedId}`); return; }
          navigate("/messages");
          return;
        }
        case "team_message":
        case "club_message":
        case "group_message":
        case "message_reply":
        case "message_mention":
        case "message_forwarded": {
          // Always anchor to the exact message the notification was created
          // for. Each notification row carries its own related_id pointing to
          // the specific message — so when the same sender has multiple
          // notifications, each one routes to its own message rather than
          // collapsing to the latest.
          const { data: teamMessage } = await supabase
            .from("team_messages")
            .select("team_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (teamMessage?.team_id) {
            setPendingChatJump("team", teamMessage.team_id, relatedId);
            navigateWithFreshJump(`/messages/${teamMessage.team_id}?message=${relatedId}`);
            return;
          }
          const { data: clubMsg } = await supabase
            .from("club_messages")
            .select("club_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (clubMsg?.club_id) {
            setPendingChatJump("club", clubMsg.club_id, relatedId);
            navigateWithFreshJump(`/messages/club/${clubMsg.club_id}?message=${relatedId}`);
            return;
          }
          const { data: groupMsg } = await supabase
            .from("group_messages")
            .select("group_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (groupMsg?.group_id) {
            setPendingChatJump("group", groupMsg.group_id, relatedId);
            navigateWithFreshJump(`/groups/${groupMsg.group_id}?message=${relatedId}`);
            return;
          }
          const { data: dmMsg } = await supabase
            .from("direct_messages")
            .select("conversation_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (dmMsg?.conversation_id) {
            setPendingChatJump("dm", dmMsg.conversation_id, relatedId);
            navigateWithFreshJump(`/messages/dm/${dmMsg.conversation_id}?message=${relatedId}`);
            return;
          }
          const { data: broadcastMsg } = await supabase
            .from("broadcast_messages")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (broadcastMsg) {
            setPendingChatJump("broadcast", null, relatedId);
            navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`);
            return;
          }
          break;
        }

        case "club_admin_message": {
          // related_id is the club_admin_messages.id — resolve the conversation
          // and deep-link to the club-admin thread anchored on this message.
          const { data: caMsg } = await supabase
            .from("club_admin_messages")
            .select("conversation_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (caMsg?.conversation_id) {
            setPendingChatJump("club_admin", caMsg.conversation_id, relatedId);
            navigateWithFreshJump(`/messages/club-admin/${caMsg.conversation_id}?message=${relatedId}`);
            return;
          }
          // Backward-compat: older rows stored conversation_id as related_id.
          const { data: caConv } = await supabase
            .from("club_admin_conversations")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (caConv) {
            navigate(`/messages/club-admin/${relatedId}`);
            return;
          }
          navigate("/messages");
          return;
        }
        case "broadcast":
          setPendingChatJump("broadcast", null, relatedId);
          navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`);
          return;

        case "direct_message": {
          const opened = await openDirectMessageNotification(relatedId, notification.created_at);
          if (!opened) navigate("/messages");
          return;
        }
        case "event_invite":
        case "event_cancelled":
        case "event_updated":
        case "event_reminder":
        case "duty_assigned":
          navigate(`/events/${relatedId}`);
          return;
        case "photo_comment":
        case "photo_reaction": {
          const { data: photoCheck } = await supabase
            .from("photos")
            .select("id, deleted_at")
            .eq("id", relatedId)
            .maybeSingle();
          if (!photoCheck || photoCheck.deleted_at) {
            toast.info("This photo is no longer available.");
            return;
          }
          // Reactions/comments target a specific photo — open the lightbox.
          const suffix = notification.type === "photo_comment" ? "&comments=1" : "";
          navigate(`/media?photo=${relatedId}${suffix}`);
          return;
        }
        case "photo_uploaded": {
          // New uploads should land on the GALLERY (filtered to the team/club),
          // never fullscreen on a single photo.
          const { data: photoCheck } = await supabase
            .from("photos")
            .select("id, team_id, club_id, deleted_at")
            .eq("id", relatedId)
            .maybeSingle();
          if (!photoCheck || photoCheck.deleted_at) {
            navigate("/media");
            return;
          }
          if (photoCheck.team_id) {
            navigate(`/media?team=${photoCheck.team_id}`);
          } else if (photoCheck.club_id) {
            navigate(`/media?club=${photoCheck.club_id}`);
          } else {
            navigate("/media");
          }
          return;
        }
        case "photo_prompt_reminder": {
          // related_id is the event_id — open Media gallery filtered to team/event with upload sheet.
          const { data: ev } = await supabase
            .from("events")
            .select("id, team_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (ev?.team_id) {
            navigate(`/media?team=${ev.team_id}&event=${ev.id}&upload=1`);
          } else {
            navigate(`/media?upload=1`);
          }
          return;
        }
        case "comment_reaction":
        case "comment_reply": {
          let targetPhotoId: string | null = null;
          if (notification.type === "comment_reply") {
            targetPhotoId = relatedId;
          } else {
            const { data: commentData } = await supabase
              .from("photo_comments")
              .select("photo_id")
              .eq("id", relatedId)
              .maybeSingle();
            targetPhotoId = commentData?.photo_id ?? null;
          }
          if (!targetPhotoId) {
            toast.info("This photo is no longer available.");
            return;
          }
          const { data: photoCheck2 } = await supabase
            .from("photos")
            .select("id, deleted_at")
            .eq("id", targetPhotoId)
            .maybeSingle();
          if (!photoCheck2 || photoCheck2.deleted_at) {
            toast.info("This photo is no longer available.");
            return;
          }
          // comment replies / reactions also belong on the comment screen
          navigate(`/media?photo=${targetPhotoId}&comments=1`);
          return;
        }
        case "join_request":
          navigate("/notifications");
          return;
        case "join_request_approved":
        case "join_request_denied":
        case "join_request_processed":
          if (relatedId) {
            const { data: clubCheckHeader } = await supabase
              .from("clubs")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (clubCheckHeader) {
              navigate(`/clubs/${relatedId}`);
            } else {
              navigate(`/teams/${relatedId}`);
            }
          } else {
            navigate("/notifications");
          }
          return;
        case "club_join":
          if (relatedId) {
            navigate(`/clubs/${relatedId}`);
          } else {
            navigate("/notifications");
          }
          return;
        case "role_assigned":
        case "invite_accepted":
        case "team_join":
        case "team_invite":
          // Navigate to team page if related_id is available
          if (relatedId) {
            if (notification.type === "team_invite") {
              const { data: inviteData } = await supabase
                .from("pending_invites")
                .select("team_id, club_id, status, metadata")
                .eq("id", relatedId)
                .maybeSingle();
              const inviteMeta = inviteData?.metadata as any;
              if (inviteMeta?.mini_league_id) {
                navigate(`/mini-leagues/${inviteMeta.mini_league_id}`);
              } else if (inviteData?.team_id) {
                navigate(`/teams/${inviteData.team_id}`);
              } else if (inviteData?.club_id) {
                navigate(`/clubs/${inviteData.club_id}`);
              } else {
                navigate("/notifications");
              }
            } else {
              navigate(`/teams/${relatedId}`);
            }
          } else {
            navigate("/notifications");
          }
          return;
        case "member_joined":
          if (relatedId) {
            const { data: miniLeagueCheckMJ } = await supabase
              .from("mini_leagues")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (miniLeagueCheckMJ) {
              navigate(`/mini-leagues/${relatedId}`);
            } else {
              const { data: clubCheckMJ } = await supabase
                .from("clubs")
                .select("id")
                .eq("id", relatedId)
                .maybeSingle();
              if (clubCheckMJ) {
                navigate(`/clubs/${relatedId}`);
              } else {
                navigate(`/teams/${relatedId}`);
              }
            }
          } else {
            navigate("/notifications");
          }
          return;
        case "rsvp":
        case "rsvp_update":
        case "rsvp_updated":
          navigate(`/events/${relatedId}`);
          return;
        case "pending_sub":
          localStorage.setItem('pitch-board-open-source', 'pending_sub');
          navigate("/");
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'pending_sub' } }));
          }, 300);
          return;
        case "formation_change":
          if (relatedId) {
            navigate(`/teams/${relatedId}`);
          }
          return;
        case "fee_payment_request":
          if (relatedId) {
            navigate(`/pay-fees/${relatedId}`);
          }
          return;
        case "early_rsvp_points":
        case "attendance_points":
        case "duty_points":
        case "points_awarded":
        case "reward_redeemed":
        case "player_of_match":
          navigate("/profile?section=points-history");
          return;
      }

      navigate("/notifications");
    } catch (error) {
      console.error("Error handling notification click:", error);
      navigate("/notifications");
    }
  };

  // Render notification icon using centralized component
  const renderNotificationIcon = (type: string) => (
    <NotificationIcon type={type} mode="emoji" />
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background pt-safe">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-muted/60 active:bg-muted transition-colors max-w-[78%]"
              aria-label="Switch club"
              key={activeClubTheme ? `club-${activeClubTheme}` : 'ignite'}
            >
              {(() => {
                const activeClubInfo = activeClubTheme
                  ? availableClubThemes.find((t) => t.clubId === activeClubTheme)
                  : null;
                const clubIsPro = !!activeClubInfo?.canUseCustomTheme;
                const displayLogoUrl = (shouldShowClubTheming && showClubLogo)
                  ? activeThemeData!.logoUrl!
                  : (clubIsPro ? activeClubInfo?.logoUrl || null : null);
                const displayName = activeClubInfo?.clubName
                  || (shouldShowClubTheming && clubNameParts?.mainName ? `${clubNameParts.mainName}${clubNameParts.suffix ? ' ' + clubNameParts.suffix : ''}` : null)
                  || 'Ignite Club HQ';
                const nameColor = shouldShowClubTheming
                  ? getBestContrastColor(
                      effectiveTheme === 'dark' ? (activeThemeData?.darkPrimary || activeThemeData?.primary) : activeThemeData?.primary,
                      effectiveTheme === 'dark' ? (activeThemeData?.darkSecondary || activeThemeData?.secondary) : activeThemeData?.secondary,
                      effectiveTheme === 'dark' ? (activeThemeData?.darkAccent || activeThemeData?.accent) : activeThemeData?.accent,
                      effectiveTheme === 'dark'
                    )
                  : undefined;

                return (
                  <>
                    {displayLogoUrl ? (
                      <div className="relative shrink-0">
                        <LogoImage
                          src={displayLogoUrl}
                          alt={displayName}
                          className="h-8 w-8 rounded-lg object-cover"
                          fallback={
                            <div className="p-1.5 rounded-lg bg-primary">
                              <Flame className="h-5 w-5 text-primary-foreground" />
                            </div>
                          }
                        />
                        {shouldShowClubTheming && (
                          <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full shadow-sm" style={{ backgroundColor: 'hsl(160, 84%, 39%)' }}>
                            <Flame className="h-2.5 w-2.5" style={{ color: 'white' }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <img
                        src={igniteIcon}
                        alt="Ignite"
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-full object-contain"
                        loading="eager"
                        decoding="sync"
                        fetchPriority="high"
                      />
                    )}
                    <div className="flex flex-col leading-tight items-start min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">
                        {activeClubTheme ? 'Club' : 'All Clubs'}
                      </span>
                      <span
                        className="font-bold text-[15px] truncate max-w-[160px] leading-tight mt-0.5"
                        style={nameColor ? { color: nameColor } : undefined}
                      >
                        {displayName}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={2.5} />
                  </>
                );
              })()}
            </button>
          </DropdownMenuTrigger>
          <LogoClubThemeDropdown />
        </DropdownMenu>


        <div className="flex items-center gap-4">
          <DropdownMenu open={notificationsOpen} onOpenChange={(open) => {
              setNotificationsOpen(open);
              if (open) refetchRecentNotifications();
            }}>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative h-11 w-11"
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
              >
                <Bell 
                  className={`h-6 w-6 transition-colors duration-200 ${
                    unreadCount > 0 
                      ? 'text-primary animate-bell-ring' 
                      : 'text-muted-foreground'
                  }`}
                  strokeWidth={2}
                  aria-hidden="true" 
                />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-destructive text-[9px] font-bold leading-none flex items-center justify-center text-destructive-foreground ring-[1.5px] ring-background">
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
              <div
                className="max-h-[350px] overflow-y-auto overscroll-contain"
                style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
              >
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
              </div>
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
                <Avatar 
                  className="h-8 w-8 border-2" 
                  style={{ 
                    borderColor: effectiveTheme === 'dark' ? 'hsla(160, 5%, 95%, 0.2)' : 'hsla(160, 10%, 10%, 0.2)'
                  }}
                >
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback 
                    className="text-xs"
                    style={{
                      backgroundColor: effectiveTheme === 'dark' ? 'hsla(160, 5%, 95%, 0.2)' : 'hsla(160, 10%, 10%, 0.2)',
                      color: effectiveTheme === 'dark' ? 'hsl(160 5% 95%)' : 'hsl(160 10% 10%)'
                    }}
                  >
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
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); navigate("/settings"); }} className="py-3 px-3">
                <Settings className="mr-3 h-5 w-5" />
                <span className="text-sm">Settings</span>
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
              <DropdownMenuItem 
                onSelect={(e) => {
                  e.preventDefault();
                  setProfileOpen(false);
                  handleThemeToggle();
                }}
                className="py-3 px-3"
                disabled={isSavingTheme}
              >
                {effectiveTheme === "dark" ? (
                  <Sun className="mr-3 h-5 w-5" />
                ) : (
                  <Moon className="mr-3 h-5 w-5" />
                )}
                <span className="text-sm">{effectiveTheme === "dark" ? "Light Mode" : "Dark Mode"}</span>
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
                onSelect={async (e) => {
                  e.preventDefault();
                  if (isSigningOut) return;
                  setIsSigningOut(true);
                  try {
                    await signOut();
                  } catch (error) {
                    console.error("Error signing out:", error);
                  } finally {
                    setIsSigningOut(false);
                    setProfileOpen(false);
                  }
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
          {isAppAdmin && (
            <DemoLoginSection open={demoLoginOpen} onOpenChange={setDemoLoginOpen} />
          )}
        </div>
      </div>
    </header>
  );
}