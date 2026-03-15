import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_POINTS_NAME = "Ignite Points";

interface PointsDisplay {
  name: string;
  iconUrl: string | null;
}

/**
 * Hook to get the custom points display name and icon for a club.
 * Falls back to "Ignite Points" if no custom name is set.
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
        .select("points_display_name, points_icon_url")
        .eq("id", clubId)
        .single();
      return {
        name: (data as any)?.points_display_name || DEFAULT_POINTS_NAME,
        iconUrl: (data as any)?.points_icon_url || null,
      };
    },
    enabled: !!clubId,
    staleTime: 1000 * 60 * 30,
  });
}

/**
 * Get the points display name synchronously when you already have the club data.
 */
export function getPointsDisplayName(club: { points_display_name?: string | null } | null | undefined): string {
  return (club as any)?.points_display_name || DEFAULT_POINTS_NAME;
}
