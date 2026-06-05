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
        .select("team_id, club_id, role")
        .eq("user_id", user!.id);

      const teamIds = new Set<string>();
      const adminClubIds = new Set<string>();
      (roles ?? []).forEach((r: any) => {
        if (r.team_id) teamIds.add(r.team_id);
        if (
          r.club_id &&
          (r.role === "club_admin" ||
            r.role === "app_admin" ||
            r.role === "association_admin")
        ) {
          adminClubIds.add(r.club_id);
        }
      });

      // Expand admin clubs to their team ids so we can include their entries
      if (adminClubIds.size > 0) {
        const { data: clubTeams } = await supabase
          .from("teams")
          .select("id")
          .in("club_id", Array.from(adminClubIds));
        (clubTeams ?? []).forEach((t: any) => teamIds.add(t.id));
      }

      if (teamIds.size === 0) return [];
      const { data } = await supabase
        .from("competition_entries")
        .select(
          "id, status, team_id, competition_id, division_id, teams:team_id(name, club_id), competitions:competition_id(name, sport, season, status), competition_divisions:division_id(name)"
        )
        .in("team_id", Array.from(teamIds))
        .in("status", ["invited", "accepted"]);
      return data ?? [];
    },
  });

  const filtered = activeClubFilter
    ? entries.filter((e: any) => e.teams?.club_id === activeClubFilter)
    : entries;

  // Dedupe by competition (a club can have multiple teams in one comp)
  const byComp = new Map<string, any>();
  filtered.forEach((e: any) => {
    const existing = byComp.get(e.competition_id);
    // Prefer accepted over invited when both exist
    if (!existing || (existing.status === "invited" && e.status === "accepted")) {
      byComp.set(e.competition_id, e);
    }
  });
  const items = Array.from(byComp.values());

  if (items.length === 0) return null;

  const pendingCount = items.filter((e: any) => e.status === "invited").length;

  return (
    <section aria-label="My competitions" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" /> My Competitions
        </h2>
        {pendingCount > 0 && (
          <Badge variant="destructive" className="text-[11px]">
            {pendingCount} pending invite{pendingCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        {items.map((e: any) => {
          const isInvited = e.status === "invited";
          return (
            <Link
              key={e.id}
              to={`/competitions/${e.competition_id}`}
              className="block"
              aria-label={
                isInvited
                  ? `Review invite to ${e.competitions?.name}`
                  : `Open ${e.competitions?.name}`
              }
            >
              <Card
                className={
                  "transition-colors " +
                  (isInvited
                    ? "border-primary/60 hover:border-primary"
                    : "hover:border-primary")
                }
              >
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
                    {isInvited && (
                      <div className="text-[11px] font-medium text-primary mt-1">
                        Invitation pending — tap to review
                      </div>
                    )}
                  </div>
                  {isInvited ? (
                    <Badge className="text-[11px] bg-primary/15 text-primary hover:bg-primary/15">
                      Invitation pending
                    </Badge>
                  ) : null}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
