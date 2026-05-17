import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, Plus, ChevronRight, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function CompetitionsPage() {
  usePageTitle("Competitions");
  const { user } = useAuth();

  // Clubs I admin (eligible to organise competitions)
  const { data: adminClubs = [] } = useQuery({
    queryKey: ["competitions-admin-clubs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin"]);
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell");
    },
  });

  // Competitions I can see (RLS handles visibility)
  const { data: competitions = [], isLoading } = useQuery({
    queryKey: ["my-competitions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, sport, season, status, visibility, starts_on, ends_on, organizer_club_id, clubs:organizer_club_id(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pending invitations on teams I admin
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["competition-pending-invites", user?.id],
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
        .select("id, status, team_id, competition_id, teams:team_id(name), competitions:competition_id(name, sport)")
        .in("team_id", teamIds)
        .eq("status", "invited");
      return data ?? [];
    },
  });

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> Competitions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Leagues and tournaments your teams are part of.
          </p>
        </div>
        {adminClubs.length > 0 && (
          <Button asChild size="sm">
            <Link to="/competitions/new">
              <Plus className="h-4 w-4 mr-1" /> New
            </Link>
          </Button>
        )}
      </header>

      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Pending invitations
          </h2>
          <div className="space-y-2">
            {pendingInvites.map((inv: any) => (
              <Link key={inv.id} to={`/competitions/${inv.competition_id}`} className="block">
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Badge variant="secondary">Invite</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{inv.competitions?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        For team: {inv.teams?.name}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">All competitions</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : competitions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No competitions yet.
              {adminClubs.length > 0 && (
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/competitions/new">Create your first competition</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {competitions.map((c: any) => (
              <Link key={c.id} to={`/competitions/${c.id}`} className="block">
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                      <Trophy className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[c.sport, c.season, c.clubs?.name].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">
                      {c.status}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
