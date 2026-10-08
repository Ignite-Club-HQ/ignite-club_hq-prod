/**
 * "You're on duty" tag for event cards. Only renders for users on the event's
 * duty team (team role holders, or parents/guardians of a child on it).
 */
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useMyDutyTeamIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-duty-team-ids", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const uid = user!.id;
      const [roles, kids, guarded] = await Promise.all([
        supabase.from("user_roles").select("team_id").eq("user_id", uid).not("team_id", "is", null),
        supabase.from("children").select("id").eq("parent_id", uid),
        supabase.from("child_guardians").select("child_id").eq("guardian_id", uid),
      ]);
      const ids = new Set<string>((roles.data ?? []).map((r: any) => r.team_id).filter(Boolean));
      const childIds = [
        ...(kids.data ?? []).map((c: any) => c.id),
        ...(guarded.data ?? []).map((g: any) => g.child_id),
      ];
      if (childIds.length > 0) {
        const { data } = await supabase
          .from("child_team_assignments")
          .select("team_id")
          .in("child_id", childIds);
        (data ?? []).forEach((a: any) => a.team_id && ids.add(a.team_id));
      }
      return Array.from(ids);
    },
  });
}

export function useMyLeagueAdminClubIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-league-admin-club-ids", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "league_admin");
      return (data ?? []).map((r: any) => r.club_id).filter(Boolean) as string[];
    },
  });
}

export function MyTeamDutyTag({ event }: { event: any }) {
  const dutyTeamId: string | null = event?.duty_team_id ?? null;
  const { data: myTeams } = useMyDutyTeamIds();
  const { data: leagueClubs } = useMyLeagueAdminClubIds();
  const isOnDuty = !!dutyTeamId && !!myTeams?.includes(dutyTeamId);
  const isLeagueAdmin = !!dutyTeamId && !!event?.club_id && !!leagueClubs?.includes(event.club_id);
  const { data: teamName } = useQuery({
    queryKey: ["duty-team-name", dutyTeamId],
    enabled: isLeagueAdmin && !isOnDuty,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("name").eq("id", dutyTeamId!).maybeSingle();
      return data?.name ?? null;
    },
  });
  if (!dutyTeamId) return null;
  const label = String(event?.duty_team_label ?? "").trim();
  if (!isOnDuty) {
    if (!isLeagueAdmin || !teamName) return null;
    return (
      <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>On duty: {teamName}{label ? ` — ${label}` : ""}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-primary">
      <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label ? `You're on ${label} duty` : "Your team is on duty"}</span>
    </div>
  );
}
