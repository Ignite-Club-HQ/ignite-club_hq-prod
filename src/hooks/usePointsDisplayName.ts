import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_POINTS_NAME = "Ignite Points";

/**
 * Hook to get the custom points display name for a club.
 * Falls back to "Ignite Points" if no custom name is set.
 */
export function usePointsDisplayName(clubId: string | null | undefined) {
  const { data: pointsName } = useQuery({
    queryKey: ["points-display-name", clubId],
    queryFn: async () => {
      if (!clubId) return DEFAULT_POINTS_NAME;
      const { data } = await supabase
        .from("clubs")
        .select("points_display_name")
        .eq("id", clubId)
        .single();
      return (data as any)?.points_display_name || DEFAULT_POINTS_NAME;
    },
    enabled: !!clubId,
    staleTime: 1000 * 60 * 30, // 30 min cache
  });

  return pointsName || DEFAULT_POINTS_NAME;
}

/**
 * Get the points display name synchronously when you already have the club data.
 */
export function getPointsDisplayName(club: { points_display_name?: string | null } | null | undefined): string {
  return (club as any)?.points_display_name || DEFAULT_POINTS_NAME;
}
