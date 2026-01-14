import { Building2, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function ClubThemeToggle() {
  const { availableClubThemes, activeClubTheme, setActiveClubTheme, isLoading } = useClubTheme();
  const { user } = useAuth();

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
          theme_enabled,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds);

      if (!clubs) return [];

      const result = clubs.map(club => {
        // Handle both array and single object subscription data
        const subs = club.club_subscriptions;
        const sub = Array.isArray(subs) && subs.length > 0 ? subs[0] : 
                   (subs && !Array.isArray(subs) ? subs : null);
        const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date());
        // Check club.is_pro flag directly (synced by trigger)
        const hasPro = club.is_pro === true || hasProFromSub === true;
        const hasTheme = club.theme_primary_h !== null;
        const themeEnabled = (club as any).theme_enabled !== false; // Default to true
        
        console.log('[ClubThemeToggle] Club:', club.name, { 
          is_pro: club.is_pro, 
          club_subscriptions: subs,
          hasProFromSub, 
          hasPro, 
          hasTheme,
          themeEnabled,
          willBeFiltered: (hasPro && !hasTheme) || !themeEnabled
        });
        
        return {
          clubId: club.id,
          clubName: club.name,
          logoUrl: club.logo_url,
          hasPro,
          hasTheme,
          themeEnabled,
          // Only selectable if Pro AND has theme AND theme is enabled
          isSelectable: hasPro && hasTheme && themeEnabled,
          primary: club.theme_primary_h !== null ? {
            h: club.theme_primary_h!,
            s: club.theme_primary_s!,
            l: club.theme_primary_l!,
          } : null,
        };
      // Filter out Pro clubs that don't have a theme OR have theme disabled
      }).filter(club => !((club.hasPro && !club.hasTheme) || (club.hasPro && !club.themeEnabled)));
      
      console.log('[ClubThemeToggle] Final clubs after filter:', result.map(c => ({ name: c.clubName, hasPro: c.hasPro })));
      return result;
    },
    enabled: !!user?.id,
  });

  // Only show non-Pro clubs in locked section that aren't already in availableClubThemes
  const availableClubIds = new Set(availableClubThemes.map(t => t.clubId));
  const lockedClubs = allUserClubs.filter(c => !c.hasPro && !availableClubIds.has(c.clubId));

  // Don't show if no clubs at all
  if (isLoading || (availableClubThemes.length === 0 && lockedClubs.length === 0)) {
    return null;
  }

  const activeTheme = availableClubThemes.find(t => t.clubId === activeClubTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative"
        >
          {activeTheme ? (
            <Avatar className="h-5 w-5">
              <AvatarImage src={activeTheme.logoUrl || undefined} />
              <AvatarFallback className="text-[8px] bg-primary text-primary-foreground">
                {activeTheme.clubName.charAt(0)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Building2 className="h-5 w-5" />
          )}
          {activeClubTheme && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary" />
          )}
          <span className="sr-only">Club theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
            src="/icon-192.png" 
            alt="Ignite" 
            className="h-8 w-8 rounded-full object-contain"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">Default</p>
            <p className="text-xs text-muted-foreground">Ignite emerald</p>
          </div>
          {!activeClubTheme && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        {/* Club themes */}
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
        {lockedClubs.length > 0 && availableClubThemes.length > 0 && <DropdownMenuSeparator />}
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
    </DropdownMenu>
  );
}
