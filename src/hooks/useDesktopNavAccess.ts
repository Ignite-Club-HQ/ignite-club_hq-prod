import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { detectGameBoardKind } from "@/lib/sportDetection";


const VAULT_ROLES = [
  "app_admin",
  "club_admin",
  "league_admin",
  "team_admin",
  "coach",
  "committee_member",
];
const PITCH_ROLES = ["app_admin", "club_admin", "team_admin", "coach"];

/**
 * Permission snapshot used by the desktop-only nav rail / action bar so items
 * the user cannot use are never rendered. Mobile surfaces are untouched.
 */
export function useDesktopNavAccess() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["desktop-nav-access", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      const rows = (roles || []) as Array<{ role: string; club_id: string | null; team_id: string | null }>;
      return {
        hasTeams: rows.some((r) => !!r.team_id),
        hasClubs: rows.some((r) => !!r.club_id),
        canAccessVault: rows.some((r) => VAULT_ROLES.includes(r.role)),
        canPitchBoard: rows.some((r) => PITCH_ROLES.includes(r.role)),
        canCreateEvent: rows.some((r) =>
          ["app_admin", "club_admin", "team_admin", "coach", "committee_member"].includes(r.role),
        ),
        canCreateTeam: rows.some((r) => r.role === "club_admin" || r.role === "app_admin"),
        teamIds: Array.from(new Set(rows.map((r) => r.team_id).filter(Boolean) as string[])),
      };
    },
  });

  return {
    hasTeams: !!data?.hasTeams,
    hasClubs: !!data?.hasClubs,
    canAccessVault: !!data?.canAccessVault,
    canPitchBoard: !!data?.canPitchBoard,
    canCreateEvent: !!data?.canCreateEvent,
    canCreateTeam: !!data?.canCreateTeam,
    teamIds: data?.teamIds ?? [],
  };
}

/**
 * Resolves the route for the desktop rail's "Pitch Board" item. The pitch board
 * has no standalone route — it lives under an event group — so we resolve the
 * user's next upcoming game and, when it has groups, deep-link to the first one.
 * Falls back to the event page, then to the schedule.
 */
export function useNextPitchBoardTarget(teamIds: string[], enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["desktop-next-pitch-board", [...teamIds].sort().join(",")],
    enabled: enabled && teamIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: events, error } = await supabase
        .from("events")
        .select("id, event_date")
        .in("team_id", teamIds)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("event_date", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
        .order("event_date", { ascending: true })
        .limit(1);
      if (error) throw error;
      const eventId = events?.[0]?.id;
      if (!eventId) return null;

      const { data: groups } = await supabase
        .from("event_groups")
        .select("id")
        .eq("event_id", eventId)
        .order("display_order")
        .limit(1);
      const groupId = groups?.[0]?.id;
      return groupId ? `/events/${eventId}/groups/${groupId}/pitch` : `/events/${eventId}`;
    },
  });

  return data ?? null;
}
