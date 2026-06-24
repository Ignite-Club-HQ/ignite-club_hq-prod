import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns whether the current user belongs to at least one Pro (or Pro Football)
 * club that has AI Catch Me Up enabled at the club level. Used to gate the
 * user-level AI Catch Me Up toggle in Settings.
 */
export function useUserHasAnyAICatchUpClub() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user-has-any-ai-catchup-club", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles?.length) return false;

      const directClubIds = roles.filter((r) => r.club_id).map((r) => r.club_id!);
      const teamIds = roles.filter((r) => r.team_id).map((r) => r.team_id!);

      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamClubIds = (teams ?? []).map((t: any) => t.club_id).filter(Boolean);
      }

      const allClubIds = Array.from(new Set([...directClubIds, ...teamClubIds]));
      if (allClubIds.length === 0) return false;

      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, ai_catch_up_enabled, club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)")
        .in("id", allClubIds);

      return (clubs ?? []).some((c: any) => {
        if (c.ai_catch_up_enabled !== true) return false;
        const sub = Array.isArray(c.club_subscriptions) ? c.club_subscriptions[0] : c.club_subscriptions;
        if (!sub) return false;
        const isPro = sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override;
        const active = !sub.expires_at || new Date(sub.expires_at) > new Date();
        return isPro && active;
      });
    },
  });

  return { hasAICatchUpClub: !!data, isLoading };
}
