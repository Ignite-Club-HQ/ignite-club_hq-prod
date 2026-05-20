import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

/**
 * Resolves whether the user has Pro access for the chat scope being scheduled
 * into. Falls back to "user has Pro on any club" for scopes without a clubId
 * (DM, group chats, broadcasts).
 */
export function useScheduleProAccess(target: ScheduleTarget | null | undefined) {
  // If target has team_id but no club_id, resolve via the team.
  const teamId = target?.team_id ?? null;
  const { data: resolvedClubId } = useQuery({
    queryKey: ["team-club-id", teamId],
    enabled: !!teamId && !target?.club_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", teamId!)
        .maybeSingle();
      return (data?.club_id as string) ?? null;
    },
  });

  const clubId = target?.club_id ?? resolvedClubId ?? null;
  const club = useClubProAccess(clubId);
  const any = useUserHasAnyClubPro();

  if (clubId) {
    return { hasAccess: club.hasPro, isLoading: club.isLoading };
  }
  return { hasAccess: any.hasAnyClubPro, isLoading: any.isLoading };
}
