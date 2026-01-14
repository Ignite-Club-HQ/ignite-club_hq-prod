import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MessagesSponsorCarousel } from "@/components/MessagesSponsorCarousel";
import { AppAdCarousel } from "@/components/AppAdCarousel";

interface SponsorOrAdCarouselProps {
  location: "home" | "events" | "messages";
  activeClubFilter?: string | null;
}

export function SponsorOrAdCarousel({ location, activeClubFilter }: SponsorOrAdCarouselProps) {
  // Check if user is a Pro user (any club they belong to has Pro)
  const { data: isProUser, isLoading: isProLoading } = useQuery({
    queryKey: ["user-is-pro", activeClubFilter],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Get all clubs the user belongs to
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);

      if (!roles || roles.length === 0) return false;

      const clubIds = roles.filter(r => r.club_id).map(r => r.club_id);
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id);

      // Get club IDs from teams
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        
        if (teams) {
          clubIds.push(...teams.map(t => t.club_id));
        }
      }

      const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
      if (uniqueClubIds.length === 0) return false;

      // Check if any of these clubs have Pro subscription
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .in("club_id", uniqueClubIds)
        .eq("is_pro", true)
        .limit(1);

      return subscriptions && subscriptions.length > 0;
    },
  });

  // Check ad settings for this location
  const { data: settings } = useQuery({
    queryKey: ["app-ad-settings", location],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("*")
        .eq("location", location)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Check if user has any sponsors (for fallback logic)
  const { data: hasSponsors } = useQuery({
    queryKey: ["user-has-sponsors", activeClubFilter],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      if (activeClubFilter) {
        const { data } = await supabase
          .from("clubs")
          .select("primary_sponsor_id")
          .eq("id", activeClubFilter)
          .single();
        return !!data?.primary_sponsor_id;
      }

      // Check all user's clubs for sponsors
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);

      if (!roles || roles.length === 0) return false;

      const clubIds = roles
        .filter(r => r.club_id)
        .map(r => r.club_id);

      const teamIds = roles
        .filter(r => r.team_id)
        .map(r => r.team_id);

      // Get club IDs from teams
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        
        if (teams) {
          clubIds.push(...teams.map(t => t.club_id));
        }
      }

      const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
      if (uniqueClubIds.length === 0) return false;

      const { data: clubs } = await supabase
        .from("clubs")
        .select("primary_sponsor_id")
        .in("id", uniqueClubIds)
        .not("primary_sponsor_id", "is", null);

      return clubs && clubs.length > 0;
    },
  });

  // While loading Pro status, don't show ads (err on the side of not showing ads to potential Pro users)
  if (isProLoading) {
    // For home, show nothing while loading
    if (location === "home") return null;
    // For other pages, show sponsor carousel (safe for both Pro and non-Pro)
    return <MessagesSponsorCarousel activeClubFilter={activeClubFilter} />;
  }

  // For HOME page: sponsors are already shown separately, this component only shows ads
  if (location === "home") {
    // Pro users never see app ads
    if (isProUser) return null;
    
    // Only show ads if enabled AND (override is on OR no sponsors exist and show_only_when_no_sponsors is on)
    if (!settings?.is_enabled) return null;
    
    if (settings.override_sponsors) {
      return <AppAdCarousel location={location} hasSponsorAds={!!hasSponsors} />;
    }
    
    if (settings.show_only_when_no_sponsors && !hasSponsors) {
      return <AppAdCarousel location={location} hasSponsorAds={false} />;
    }
    
    return null;
  }

  // For EVENTS and MESSAGES pages: this component handles both sponsors and ads
  
  // Pro users never see app ads, only sponsors
  if (isProUser) {
    return <MessagesSponsorCarousel activeClubFilter={activeClubFilter} />;
  }
  
  // If ads enabled and override sponsors, only show ads
  if (settings?.is_enabled && settings?.override_sponsors) {
    return <AppAdCarousel location={location} hasSponsorAds={!!hasSponsors} />;
  }

  // If ads enabled and show only when no sponsors
  if (settings?.is_enabled && settings?.show_only_when_no_sponsors) {
    if (!hasSponsors) {
      return <AppAdCarousel location={location} hasSponsorAds={false} />;
    }
    // Has sponsors, show sponsor carousel
    return <MessagesSponsorCarousel activeClubFilter={activeClubFilter} />;
  }

  // Default: show sponsor carousel (it handles its own empty state)
  return <MessagesSponsorCarousel activeClubFilter={activeClubFilter} />;
}
