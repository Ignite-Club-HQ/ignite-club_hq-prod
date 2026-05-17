import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, ChevronRight, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function HomePendingCompetitionInvitesCard() {
  const { user } = useAuth();

  const { data: invites = [] } = useQuery({
    queryKey: ["home-pending-competition-invites", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);
      const teamIds = Array.from(new Set((roles ?? []).map((r: any) => r.team_id).filter(Boolean)));
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("competition_entries")
        .select("id, team_id, competition_id, teams:team_id(name), competitions:competition_id(name, sport, season)")
        .in("team_id", teamIds)
        .eq("status", "invited");
      return data ?? [];
    },
  });

  if (invites.length === 0) return null;

  return (
    <section aria-label="Pending competition invites" className="space-y-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" /> Competition invites
        <Badge variant="destructive">{invites.length}</Badge>
      </h2>
      <div className="space-y-2">
        {invites.map((inv: any) => (
          <Link key={inv.id} to={`/competitions/${inv.competition_id}`} className="block">
            <Card className="hover:border-primary transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <Trophy className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{inv.competitions?.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    For {inv.teams?.name}
                    {inv.competitions?.season ? ` · ${inv.competitions.season}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
