import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns whether the given club has active Pro or Pro Football access,
 * including admin overrides. Used to gate Pro-only features client-side.
 */
export function useClubProAccess(
  clubId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && !!clubId;
  const { data, isLoading } = useQuery({
    queryKey: ["club-pro-access", clubId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: sub } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .eq("club_id", clubId!)
        .maybeSingle();

      if (!sub) return { hasPro: false, hasProFootball: false };

      const notExpired = !sub.expires_at || new Date(sub.expires_at) > new Date();
      const hasPro = notExpired && !!(sub.is_pro || sub.admin_pro_override);
      const hasProFootball = notExpired && !!(sub.is_pro_football || sub.admin_pro_football_override);

      return { hasPro: hasPro || hasProFootball, hasProFootball };
    },
  });

  return {
    hasPro: !!data?.hasPro,
    hasProFootball: !!data?.hasProFootball,
    isLoading,
  };
}
