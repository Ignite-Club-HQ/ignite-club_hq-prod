import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClubSubscriptionEntitlements {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
  expires_at?: string | null;
}

export function resolveClubProAccess(
  sub: ClubSubscriptionEntitlements | null,
  now = new Date(),
) {
  if (!sub) return { hasPro: false, hasProFootball: false, resolved: true };

  const notExpired = !sub.expires_at || new Date(sub.expires_at) > now;
  const hasPro = notExpired && !!(sub.is_pro || sub.admin_pro_override);
  const hasProFootball =
    notExpired && !!(sub.is_pro_football || sub.admin_pro_football_override);

  return {
    hasPro: hasPro || hasProFootball,
    hasProFootball,
    resolved: true,
  };
}

/**
 * Returns whether the given club has active Pro or Pro Football access,
 * including admin overrides. Used to gate Pro-only features client-side.
 *
 * Resilience: the query throws on Supabase errors (so react-query keeps prior
 * data instead of caching a false "no-Pro" result on a transient failure), and
 * uses `keepPreviousData` so resume/reconnect refetches never flash a PRO lock
 * badge on a Pro club while the background refetch is in flight.
 */
export function useClubProAccess(
  clubId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && !!clubId;
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["club-pro-access", clubId],
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data: sub, error } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .eq("club_id", clubId!)
        .maybeSingle();

      // Propagate transient errors so react-query keeps previous data rather
      // than treating a network/RLS hiccup as "no Pro".
      if (error) throw error;
      return resolveClubProAccess(sub);
    },
  });

  return {
    hasPro: !!data?.hasPro,
    hasProFootball: !!data?.hasProFootball,
    // True while the first successful resolution for this clubId hasn't landed.
    // Callers should treat "loading" as "don't show locked yet" to avoid a
    // brief PRO badge flash on resume/reconnect.
    isLoading: isLoading || (enabled && !isFetched && !data?.resolved),
  };
}
