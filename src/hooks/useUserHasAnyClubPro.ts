import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns whether the current user has active Pro (or Pro Football) access
 * on AT LEAST ONE club they belong to (either directly or via a team).
 * Used to gate user-level Pro features (e.g. scheduled messages).
 */
export function useUserHasAnyClubPro() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user-has-any-club-pro", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      // Gather club ids from direct roles + team memberships
      const [rolesRes, membersRes] = await Promise.all([
        supabase.from("user_roles").select("club_id").eq("user_id", user!.id),
        supabase.from("team_members").select("teams:team_id(club_id)").eq("user_id", user!.id),
      ]);

      const directClubIds = (rolesRes.data ?? [])
        .map((r: any) => r.club_id)
        .filter(Boolean);
      const teamClubIds = (membersRes.data ?? [])
        .map((m: any) => m.teams?.club_id)
        .filter(Boolean);
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
