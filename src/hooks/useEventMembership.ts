import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Whether the current user (or any of their children) is a member of the
 * team/club this event belongs to. Used to gate "RSVP Required" prompts —
 * non-members should never be nagged to RSVP for an event that isn't theirs.
 *
 * Membership rules:
 *  - Team events: user has a `user_roles` row for that team_id, OR has a
 *    child assigned to that team via `child_team_assignments`.
 *  - Club events (no team_id): user has any `user_roles` row for the club_id.
 *
 * Returns `true` while loading so we don't briefly hide content for members.
 * The caller can check `isFetched` if it needs to wait.
 */
export function useEventMembership(event: {
  team_id: string | null;
  club_id: string;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["event-membership", event.team_id, event.club_id, user?.id],
    queryFn: async (): Promise<boolean> => {
      if (!user) return false;

      if (event.team_id) {
        // Direct team role
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user.id)
          .eq("team_id", event.team_id)
          .limit(1)
          .maybeSingle();
        if (roleRow) return true;

        // Child on the team — own children
        const { data: ownChildren } = await supabase
          .from("children")
          .select("id, child_team_assignments!inner(team_id)")
          .eq("parent_id", user.id)
          .eq("child_team_assignments.team_id", event.team_id)
          .limit(1);
        if ((ownChildren?.length ?? 0) > 0) return true;

        // Child on the team — guardian links
        const { data: guardianLinks } = await supabase
          .from("child_guardians")
          .select("child_id")
          .eq("guardian_id", user.id);
        const guardianChildIds = (guardianLinks ?? []).map((g) => g.child_id);
        if (guardianChildIds.length > 0) {
          const { data: assignments } = await supabase
            .from("child_team_assignments")
            .select("child_id")
            .eq("team_id", event.team_id)
            .in("child_id", guardianChildIds)
            .limit(1);
          if ((assignments?.length ?? 0) > 0) return true;
        }

        return false;
      }

      // Club-wide event — any club role qualifies
      const { data: clubRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("club_id", event.club_id)
        .limit(1)
        .maybeSingle();
      return !!clubRole;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
