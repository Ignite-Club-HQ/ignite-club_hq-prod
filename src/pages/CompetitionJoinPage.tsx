import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/usePageTitle";

type CompInfo = {
  id: string;
  name: string;
  organizer_club_id: string;
  organizer_club_name: string | null;
  sport: string | null;
  season: string | null;
  status: string;
};
type Division = { id: string; name: string };
type TeamOpt = { id: string; name: string; club_id: string; club_name: string | null };

export default function CompetitionJoinPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  usePageTitle("Join competition");

  const [comp, setComp] = useState<CompInfo | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [divisionId, setDivisionId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState(false);

  // Load competition info (works pre-auth via SECURITY DEFINER RPC)
  useEffect(() => {
    if (!token) {
      setError("Missing or invalid join link.");
      setLoading(false);
      return;
    }
    (async () => {
      const [{ data: compRows, error: cErr }, { data: divRows }] = await Promise.all([
        supabase.rpc("get_competition_by_join_token", { p_token: token }),
        supabase.rpc("list_divisions_by_join_token", { p_token: token }),
      ]);
      if (cErr || !compRows || !(compRows as any[]).length) {
        setError("This join link is invalid or has been disabled.");
        setLoading(false);
        return;
      }
      setComp((compRows as any[])[0]);
      setDivisions((divRows as any[]) || []);
      setLoading(false);
    })();
  }, [token]);

  // Load user's admin teams once signed in
  useEffect(() => {
    if (!user) return;
    (async () => {
      // 1) Direct team-admin rows (team-scoped)
      const teamAdminRowsP = supabase
        .from("user_roles")
        .select("team_id, teams:team_id(id, name, club_id, clubs:club_id(name))")
        .eq("user_id", user.id)
        .in("role", ["team_admin", "app_admin"])
        .not("team_id", "is", null);

      // 2) Club-scoped admin/app_admin rows → expand to all teams in those clubs
      const clubAdminRowsP = supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .in("role", ["club_admin", "app_admin"])
        .not("club_id", "is", null);

      const [{ data: teamRows }, { data: clubRows }] = await Promise.all([
        teamAdminRowsP,
        clubAdminRowsP,
      ]);

      const seen = new Set<string>();
      const opts: TeamOpt[] = [];

      for (const row of (teamRows as any[]) || []) {
        const t = row.teams;
        if (!t || seen.has(t.id)) continue;
        seen.add(t.id);
        opts.push({ id: t.id, name: t.name, club_id: t.club_id, club_name: t.clubs?.name ?? null });
      }

      const clubIds = Array.from(
        new Set(((clubRows as any[]) || []).map((r) => r.club_id).filter(Boolean))
      );
      if (clubIds.length > 0) {
        const { data: clubTeams } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs:club_id(name)")
          .in("club_id", clubIds);
        for (const t of (clubTeams as any[]) || []) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          opts.push({ id: t.id, name: t.name, club_id: t.club_id, club_name: t.clubs?.name ?? null });
        }
      }

      opts.sort((a, b) => a.name.localeCompare(b.name));
      setTeams(opts);
      if (opts.length === 1) setTeamId(opts[0].id);
    })();
  }, [user]);



  const requireSignIn = () => {
    sessionStorage.setItem("redirectAfterAuth", `/competitions/join?token=${token}`);
    navigate("/auth");
  };

  const handleJoin = async () => {
    if (!user) return requireSignIn();
    if (!teamId) {
      toast({ title: "Pick a team to enter", variant: "destructive" });
      return;
    }
    if (divisions.length > 0 && !divisionId) {
      toast({ title: "Pick a division", variant: "destructive" });
      return;
    }
    setJoining(true);
    const { data, error } = await supabase.rpc("join_competition_with_token", {
      p_token: token,
      p_team_id: teamId,
      p_division_id: divisionId || null,
    });
    setJoining(false);
    if (error) {
      toast({ title: "Could not join", description: error.message, variant: "destructive" });
      return;
    }
    setDone(true);
    const compId = (data as any[])?.[0]?.competition_id;
    setTimeout(() => navigate(`/competitions/${compId}`), 1200);
  };

  const goStartTeam = () => {
    // Preserve the join intent so the user lands back here after creating a team.
    const back = `/competitions/join?token=${token}`;
    sessionStorage.setItem("redirectAfterAuth", back);
    // CreateTeamPage reads this on success and routes back here instead of /teams/:id
    sessionStorage.setItem("pendingCompetitionJoinToken", token);
    navigate("/teams/new");
  };


  const heading = useMemo(() => comp?.name ?? "Competition", [comp]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !comp) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p>{error || "Competition not found."}</p>
            <Button asChild variant="outline"><Link to="/">Go home</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
            <p className="font-medium">You're in!</p>
            <p className="text-sm text-muted-foreground">Taking you to {heading}…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Trophy className="h-4 w-4" /> Join competition
          </div>
          <CardTitle>{heading}</CardTitle>
          {comp.organizer_club_name && (
            <p className="text-sm text-muted-foreground">
              Organised by {comp.organizer_club_name}
              {comp.season ? ` · ${comp.season}` : ""}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!user ? (
            <>
              <p className="text-sm">Sign in to enter one of your teams in this competition.</p>
              <Button className="w-full" onClick={requireSignIn}>Sign in to join</Button>
            </>
          ) : teams.length === 0 ? (
            <>
              <p className="text-sm">
                You don't admin any teams yet. Start a team to enter it in this competition.
              </p>
              <Button className="w-full" onClick={goStartTeam}>Start a new team</Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/teams">Go to my teams</Link>
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Choose team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger><SelectValue placeholder="Select a team" /></SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.club_name ? ` · ${t.club_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={goStartTeam}
                  className="text-xs text-primary underline underline-offset-2"
                >
                  Don't see your team? Start a new one
                </button>
              </div>

              {divisions.length > 0 && (
                <div className="space-y-2">
                  <Label>Division</Label>
                  <Select value={divisionId} onValueChange={setDivisionId}>
                    <SelectTrigger><SelectValue placeholder="Pick a division" /></SelectTrigger>
                    <SelectContent>
                      {divisions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleJoin}
                disabled={joining || !teamId || (divisions.length > 0 && !divisionId)}
              >
                {joining && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Join competition
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Organisers can remove teams later from the Teams tab.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

}
