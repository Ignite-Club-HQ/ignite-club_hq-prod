import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { supabase } from "@/integrations/supabase/client";

export default function HomeMyCompetitionsCard() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();

  const { data: entries = [] } = useQuery({
    queryKey: ["home-my-competitions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id);
      const teamIds = Array.from(
        new Set((roles ?? []).map((r: any) => r.team_id).filter(Boolean))
      );
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("competition_entries")
        .select(
          "id, team_id, competition_id, division_id, teams:team_id(name, club_id), competitions:competition_id(name, sport, season, status), competition_divisions:division_id(name)"
        )
        .in("team_id", teamIds)
        .eq("status", "accepted");
      return data ?? [];
    },
  });

  const filtered = activeClubFilter
    ? entries.filter((e: any) => e.teams?.club_id === activeClubFilter)
    : entries;

  // Dedupe by competition (a club can have multiple teams in one comp)
  const byComp = new Map<string, any>();
  filtered.forEach((e: any) => {
    if (!byComp.has(e.competition_id)) byComp.set(e.competition_id, e);
  });
  const items = Array.from(byComp.values());

  if (items.length === 0) return null;

  return (
    <section aria-label="My competitions" className="space-y-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" /> My Competitions
        <Badge variant="secondary">{items.length}</Badge>
      </h2>
      <div className="space-y-2">
        {items.map((e: any) => (
          <Link
            key={e.id}
            to={`/competitions/${e.competition_id}`}
            className="block"
          >
            <Card className="hover:border-primary transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <Trophy className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {e.competitions?.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[
                      e.teams?.name,
                      e.competitions?.season,
                      e.competition_divisions?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
