import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MessagesSponsorCarousel } from "@/components/MessagesSponsorCarousel";
import { AppAdCarousel } from "@/components/AppAdCarousel";
import { AdMobBannerZone } from "@/components/AdMobBannerZone";

interface SponsorOrAdCarouselProps {
  location: "home" | "events" | "messages" | "event-detail" | "schedule";
  activeClubFilter?: string | null;
}

// Events sponsor strip is per-club opt-in via clubs.events_sponsor_strip_enabled.

export function SponsorOrAdCarousel({ location, activeClubFilter }: SponsorOrAdCarouselProps) {
  const isEventsPlacement = location === "events" || location === "event-detail";

  // Events-placement gate: any club that has events_sponsor_strip_enabled = true.
  // If no filter is set, pick the first such club the user is a member of.
  const { data: eventsStripResolved, isLoading: isStripGateLoading } = useQuery({
    queryKey: ["events-sponsor-strip-allowed", activeClubFilter],
    queryFn: async () => {
      if (activeClubFilter) {
        const { data } = await supabase
          .from("clubs")
          .select("events_sponsor_strip_enabled")
          .eq("id", activeClubFilter)
          .maybeSingle();
        const allowed = !!(data as any)?.events_sponsor_strip_enabled;
        return { allowed, effectiveClubId: allowed ? activeClubFilter : null };
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { allowed: false, effectiveClubId: null as string | null };

      const { data: directRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);

      const clubIds = new Set<string>();
      (directRoles ?? []).forEach((r: any) => { if (r.club_id) clubIds.add(r.club_id); });
      const teamIds = (directRoles ?? []).map((r: any) => r.team_id).filter(Boolean);
      if (teamIds.length) {
        const { data: teams } = await supabase
          .from("teams").select("club_id").in("id", teamIds);
        (teams ?? []).forEach((t: any) => t.club_id && clubIds.add(t.club_id));
      }
      if (clubIds.size === 0) return { allowed: false, effectiveClubId: null };

      const { data: enabledClubs } = await supabase
        .from("clubs")
        .select("id, events_sponsor_strip_enabled")
        .in("id", Array.from(clubIds));
      const hit = (enabledClubs ?? []).find((c: any) => c.events_sponsor_strip_enabled);
      return { allowed: !!hit, effectiveClubId: hit?.id ?? null };
    },
    enabled: isEventsPlacement,
  });

  const eventsStripAllowed = eventsStripResolved?.allowed ?? false;
  // For events placement, scope downstream Pro/sponsor lookups to the pilot club
  // so the strip renders even when the user hasn't explicitly filtered to it.
  const effectiveClubFilter = isEventsPlacement && eventsStripResolved?.effectiveClubId
    ? eventsStripResolved.effectiveClubId
    : activeClubFilter ?? null;


  // Check Pro status per-club (filtered club) or globally (no filter)
  const { data: proStatus, isLoading: isProLoading } = useQuery({
    queryKey: ["user-pro-status-per-club", effectiveClubFilter],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { isProFiltered: false, hasAnyPro: false };

      // Get all clubs the user belongs to
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);

      if (!roles || roles.length === 0) return { isProFiltered: false, hasAnyPro: false };

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
      if (uniqueClubIds.length === 0) return { isProFiltered: false, hasAnyPro: false };

      // Fetch Pro subscriptions for all user clubs
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro")
        .in("club_id", uniqueClubIds)
        .eq("is_pro", true);

      const proClubIds = new Set(subscriptions?.map(s => s.club_id) || []);
      const hasAnyPro = proClubIds.size > 0;

      // If filtered to a specific club, check if THAT club is Pro
      const isProFiltered = effectiveClubFilter ? proClubIds.has(effectiveClubFilter) : hasAnyPro;

      return { isProFiltered, hasAnyPro };
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

  // Check if user has any ACTIVE sponsors (from sponsors table, not primary_sponsor_id)
  const { data: hasSponsors } = useQuery({
    queryKey: ["user-has-active-sponsors", effectiveClubFilter],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      if (effectiveClubFilter) {
        // Check if this specific club has active sponsors
        const { data } = await supabase
          .from("sponsors")
          .select("id")
          .eq("club_id", effectiveClubFilter)
          .eq("is_active", true)
          .limit(1);
        return !!data && data.length > 0;
      }

      // Check all user's clubs for active sponsors
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user.id);

      if (!roles || roles.length === 0) return false;

      const clubIds = roles.filter(r => r.club_id).map(r => r.club_id);
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id);

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

      const { data: sponsors } = await supabase
        .from("sponsors")
        .select("id")
        .in("club_id", uniqueClubIds)
        .eq("is_active", true)
        .limit(1);

      return !!sponsors && sponsors.length > 0;
    },
  });

  const isProFiltered = proStatus?.isProFiltered ?? false;
  const isNative = !!(window as any).Capacitor;

  // While loading Pro status, don't show ads
  if (isProLoading) {
    return null;
  }

  // Events placement: gated by pilot club + per-club opt-in toggle.
  if (isEventsPlacement) {
    if (isStripGateLoading) return null;
    if (!eventsStripAllowed) return null;
  }

  // === PRO CLUB ===
  if (isProFiltered) {
    // Pro club WITH sponsors → show club sponsor banners
    if (hasSponsors) {
      if (location === "home") {
        // On home, sponsors are shown separately via ClubSponsorSection
        return null;
      }
      return (
        <>
          <MessagesSponsorCarousel activeClubFilter={effectiveClubFilter} />
          {isNative && <AdMobBannerZone show={true} />}
        </>
      );
    }
    // Pro club WITHOUT sponsors → show nothing (no ads for Pro)
    return isNative ? <AdMobBannerZone show={true} /> : null;
  }

  // === FREE CLUB ===
  // Free clubs CANNOT have their own sponsors (Pro-only feature)
  // Only app admin ads are shown to free clubs
  if (settings?.is_enabled) {
    return (
      <>
        <AppAdCarousel
          location={location}
          hasSponsorAds={false}
          suppressUpgradeAdsForProUsers={false}
        />
        {isNative && <AdMobBannerZone show={true} />}
      </>
    );
  }

  // No ads enabled
  return isNative ? <AdMobBannerZone show={true} /> : null;
}
