import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/**
 * Sport-contextual match score card.
 *
 * Today: soccer-only manual entry (Goals For / Goals Against).
 * Surface is sport-aware so we can extend later (basketball points,
 * netball quarter scores, etc.) without changing the call site.
 *
 * Permissions:
 *  - View: any team member (gated by parent component).
 *  - Edit: team admins, coaches, club admins, or the user assigned the
 *    "Subs Manager" duty for this event (matches RLS on game_results).
 */
interface MatchScoreCardProps {
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string | null;
  sport: "soccer";
  canEdit: boolean;
}

export function MatchScoreCard({
  eventId,
  teamId,
  teamName,
  opponent,
  sport,
  canEdit,
}: MatchScoreCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: result, isLoading } = useQuery({
    queryKey: ["match-score", eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from("game_results")
        .select("id, home_score, away_score, home_label, away_label, saved_by")
        .eq("event_id", eventId)
        .maybeSingle();
      return data;
    },
    enabled: !!eventId,
  });

  useEffect(() => {
    if (open) {
      setHomeScore(result?.home_score?.toString() ?? "");
      setAwayScore(result?.away_score?.toString() ?? "");
    }
  }, [open, result]);

  const labelHome = result?.home_label || teamName;
  const labelAway = result?.away_label || opponent || "Opponent";

  const sportTermSingular = "goal";
  const sportTermPlural = "goals";

  const handleSave = async () => {
    if (!user) return;
    const h = parseInt(homeScore, 10);
    const a = parseInt(awayScore, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      toast({
        title: "Invalid score",
        description: `Please enter valid ${sportTermPlural} for both teams.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        team_id: teamId,
        event_id: eventId,
        sport,
        home_label: teamName,
        away_label: opponent || "Opponent",
        home_score: h,
        away_score: a,
        period_scores: [],
        player_stats: [],
        saved_by: user.id,
      };
      const { error } = await supabase
        .from("game_results")
        .upsert(payload, { onConflict: "event_id" });
      if (error) throw error;
      toast({
        title: "Score saved",
        description: `${labelHome} ${h} – ${a} ${labelAway}`,
      });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["match-score", eventId] });
    } catch (err) {
      const msg = (err as Error).message;
      toast({
        title: "Couldn't save score",
        description: /row-level security/i.test(msg)
          ? "Only admins, coaches, or the assigned Subs Manager can record the score."
          : msg,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;

  const hasScore = !!result;
  const won = hasScore && (result!.home_score ?? 0) > (result!.away_score ?? 0);
  const lost = hasScore && (result!.home_score ?? 0) < (result!.away_score ?? 0);
  const drawn = hasScore && (result!.home_score ?? 0) === (result!.away_score ?? 0);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Trophy className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Match Score</p>
                {hasScore ? (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-base font-bold">
                      {labelHome} {result!.home_score} – {result!.away_score} {labelAway}
                    </span>
                    {won && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Win</Badge>}
                    {lost && <Badge variant="destructive">Loss</Badge>}
                    {drawn && <Badge variant="secondary">Draw</Badge>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    No score recorded yet
                  </p>
                )}
              </div>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant={hasScore ? "ghost" : "default"}
                onClick={() => setOpen(true)}
              >
                {hasScore ? (
                  <>
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" /> Record
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{hasScore ? "Edit" : "Record"} Match Score</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 py-2">
            <div>
              <Label htmlFor="home-score" className="text-xs text-muted-foreground">
                {labelHome}
              </Label>
              <Input
                id="home-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
                className="text-center text-2xl font-bold h-14 mt-1"
                placeholder="0"
              />
            </div>
            <div className="pb-4 text-xl font-bold text-muted-foreground">–</div>
            <div>
              <Label htmlFor="away-score" className="text-xs text-muted-foreground">
                {labelAway}
              </Label>
              <Input
                id="away-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
                className="text-center text-2xl font-bold h-14 mt-1"
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Enter the final number of {sportTermPlural} for each side.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save score"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
