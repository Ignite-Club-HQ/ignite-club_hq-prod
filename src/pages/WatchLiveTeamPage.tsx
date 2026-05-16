import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Eye, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useCourtSpectator } from "@/hooks/useCourtSpectator";
import BasketballSpectatorView from "@/components/scoreboard/BasketballSpectatorView";
import NetballSpectatorView from "@/components/scoreboard/NetballSpectatorView";
import SoccerSpectatorView from "@/components/scoreboard/SoccerSpectatorView";

/**
 * Watch Live page for parents/players.
 *
 * Resolves the most recent active basketball or netball game for the team
 * from `active_games` and renders the matching read-only spectator view.
 * Access is gated entirely by the team-membership RLS policy on
 * `active_games` ("Team members can view team games").
 */
export default function WatchLiveTeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ["watch-live-team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, club_id")
        .eq("id", teamId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  const { state, isLoading, noActiveGame, error } = useCourtSpectator(teamId);

  // Surface fetch errors as a toast and bounce home.
  useEffect(() => {
    if (!error) return;
    toast({
      title: "Couldn't load the live game",
      description: error,
      variant: "destructive",
    });
  }, [error, toast]);

  const close = useMemo(
    () => () => {
      if (window.history.length > 1) navigate(-1);
      else navigate(`/teams/${teamId}`);
    },
    [navigate, teamId]
  );

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Sign in to watch live games.</p>
        <Button onClick={() => navigate("/auth")}>Sign in</Button>
      </div>
    );
  }

  if (teamLoading || (isLoading && !state)) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          We can't find this team — you may not be a member.
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Home
        </Button>
      </div>
    );
  }

  if (noActiveGame || !state) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 p-6 text-center bg-background">
        <Eye className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="font-bold text-base">{team.name}</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            No live game right now. The board will appear here when the coach starts one.
          </p>
        </div>
        <Button variant="outline" onClick={close}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to team
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-background">
      {state.sport === "basketball" ? (
        <BasketballSpectatorView
          teamName={team.name}
          board={state.board}
          timer={state.timer}
          receivedAt={state.receivedAt}
          onClose={close}
        />
      ) : state.sport === "netball" ? (
        <NetballSpectatorView
          teamName={team.name}
          board={state.board}
          timer={state.timer}
          receivedAt={state.receivedAt}
          onClose={close}
        />
      ) : (
        <SoccerSpectatorView
          teamName={team.name}
          board={state.board}
          timer={state.timer}
          receivedAt={state.receivedAt}
          onClose={close}
        />
      )}
    </div>
  );
}
