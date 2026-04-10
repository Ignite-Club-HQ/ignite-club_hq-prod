import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_POINTS_NAME = "Reward Points";

interface PointsDisplay {
  name: string;
  iconUrl: string | null;
}

/**
 * Hook to get the custom points display name and icon for a club.
 * Falls back to "Reward Points" if no custom name is set.
 */
export function usePointsDisplayName(clubId: string | null | undefined): string {
  const { data } = usePointsDisplay(clubId);
  return data?.name || DEFAULT_POINTS_NAME;
}

/**
 * Hook to get both the custom points display name and icon URL for a club.
 */
export function usePointsDisplay(clubId: string | null | undefined) {
  return useQuery<PointsDisplay>({
    queryKey: ["points-display", clubId],
    queryFn: async () => {
      if (!clubId) return { name: DEFAULT_POINTS_NAME, iconUrl: null };
      const { data } = await supabase
        .from("clubs")
        .select("points_display_name, points_icon_url, theme_enabled, club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)")
        .eq("id", clubId)
        .single();
      const club = data as any;
      const sub = club?.club_subscriptions?.[0] ?? club?.club_subscriptions;
      const isActive = !sub?.expires_at || new Date(sub.expires_at) > new Date();
      const isPro = isActive && (sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override);
      const canCustomise = isPro && club?.theme_enabled;
      return {
        name: (canCustomise && club?.points_display_name) || DEFAULT_POINTS_NAME,
        iconUrl: (canCustomise && club?.points_icon_url) || null,
      };
    },
    enabled: !!clubId,
    staleTime: 1000 * 60 * 30,
  });
}

/**
 * Get the points display name synchronously when you already have the club data.
 */
export function getPointsDisplayName(club: { points_display_name?: string | null; theme_enabled?: boolean; is_pro?: boolean; club_subscriptions?: any } | null | undefined): string {
  const c = club as any;
  const sub = Array.isArray(c?.club_subscriptions) ? c.club_subscriptions[0] : c?.club_subscriptions;
  const isActive = !sub?.expires_at || new Date(sub.expires_at) > new Date();
  const isPro = isActive && (c?.is_pro || sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override);
  const canCustomise = isPro && c?.theme_enabled;
  return (canCustomise && c?.points_display_name) || DEFAULT_POINTS_NAME;
}
