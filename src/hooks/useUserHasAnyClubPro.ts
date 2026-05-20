import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns whether the current user has active Pro (or Pro Football) access
 * on AT LEAST ONE club they belong to (directly or via a team in user_roles).
 * Used to gate user-level Pro features (e.g. scheduled messages).
 */
export function useUserHasAnyClubPro() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user-has-any-club-pro", user?.id],
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

      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", allClubIds);

      return (subs ?? []).some(
        (s: any) =>
          (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override) &&
          (!s.expires_at || new Date(s.expires_at) > new Date()),
      );
    },
  });

  return { hasAnyClubPro: !!data, isLoading };
}
