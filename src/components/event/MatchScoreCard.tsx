import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Pencil, Plus, Target, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

import { getSportScoreConfig } from "@/lib/sportScoreConfig";

/**
 * Sport-contextual match score card.
 *
 * The same underlying `game_results` row drives every sport — only the
 * vocabulary (goals vs points vs runs, scorers heading, own-goal option)
 * changes per sport via `getSportScoreConfig(sport)`.
 *
 * Per-player attribution is stored inside `game_results.player_stats`
 * as `[{ id, name, goals }]` (the column is named after soccer's first
 * use; we re-use it for points/runs across every sport so the existing
 * MVP / leaderboard / history surfaces keep working without a schema
 * change).
 */
interface MatchScoreCardProps {
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string | null;
  /** Raw club sport string (e.g. "Soccer", "Basketball", "Cricket"). */
  sport: string | null | undefined;
  canEdit: boolean;
}

interface RosterPlayer {
  id: string;
  name: string;
}

interface PlayerGoalRow {
  id: string;
  name: string;
  goals: number;
}

export function MatchScoreCard({
  eventId,
  teamId,
  teamName,
  opponent,
  sport,
  canEdit,
}: MatchScoreCardProps) {
  const sportConfig = useMemo(() => getSportScoreConfig(sport), [sport]);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [scorers, setScorers] = useState<PlayerGoalRow[]>([]);
  const [pendingScorerId, setPendingScorerId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: result, isLoading } = useQuery({
    queryKey: ["match-score", eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from("game_results")
        .select(
          "id, home_score, away_score, home_label, away_label, saved_by, player_stats"
        )
        .eq("event_id", eventId)
        .maybeSingle();
      return data;
    },
    enabled: !!eventId,
  });

  // Roster: children assigned to the team + adult players via user_roles -> profiles
  const { data: roster } = useQuery({
    queryKey: ["match-score-roster", teamId],
    queryFn: async (): Promise<RosterPlayer[]> => {
      const [childrenRes, rolesRes] = await Promise.all([
        supabase
          .from("child_team_assignments")
          .select("child_id, children(id, name)")
          .eq("team_id", teamId),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("team_id", teamId)
          .eq("role", "player"),
      ]);

      const children = (childrenRes.data || [])
        .map((r: any) => r.children)
        .filter(Boolean) as RosterPlayer[];

      const userIds = (rolesRes.data || []).map((r: any) => r.user_id);
      let adults: RosterPlayer[] = [];
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds);
        adults = (profiles || []).map((p: any) => ({
          id: p.id,
          name: p.display_name || "Player",
        }));
      }

      const seen = new Set<string>();
      const all = [...children, ...adults].filter((p) => {
        if (!p?.id || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      all.sort((a, b) => a.name.localeCompare(b.name));
      return all;
    },
    enabled: !!teamId && open,
  });

  useEffect(() => {
    if (open) {
      setHomeScore(result?.home_score?.toString() ?? "");
      setAwayScore(result?.away_score?.toString() ?? "");
      // Hydrate scorers from existing player_stats
      const existing = Array.isArray(result?.player_stats)
        ? (result!.player_stats as any[])
            .filter((p) => p && p.id && (p.goals ?? 0) > 0)
            .map((p) => ({
              id: String(p.id),
              name: String(p.name || "Player"),
              goals: Number(p.goals) || 0,
            }))
        : [];
      setScorers(existing);
      setPendingScorerId("");
    }
  }, [open, result]);

  const labelHome = result?.home_label || teamName;
  // Prefer the live opponent name from the event over a stale/generic
  // saved away_label (older scores were saved as "Opponent" when the
  // event didn't yet have an opponent populated).
  const savedAway = result?.away_label;
  const labelAway =
    opponent ||
    (savedAway && savedAway.toLowerCase() !== "opponent" ? savedAway : "Opponent");

  const totalAttributedGoals = useMemo(
    () => scorers.reduce((sum, s) => sum + (s.goals || 0), 0),
    [scorers]
  );
  const homeNum = parseInt(homeScore, 10);
  const overAttributed =
    !isNaN(homeNum) && totalAttributedGoals > homeNum && homeNum >= 0;

  const OWN_GOAL_ID = "__own_goal__";
  const OWN_GOAL_NAME = `Own ${sportConfig.unit} (opposition)`;

  const addScorer = () => {
    if (!pendingScorerId) return;
    const isOwn = pendingScorerId === OWN_GOAL_ID;
    const player = isOwn
      ? { id: OWN_GOAL_ID, name: OWN_GOAL_NAME }
      : roster?.find((p) => p.id === pendingScorerId);
    if (!player) return;
    setScorers((prev) => {
      const existing = prev.find((s) => s.id === player.id);
      if (existing) {
        return prev.map((s) =>
          s.id === player.id ? { ...s, goals: s.goals + 1 } : s
        );
      }
      return [...prev, { id: player.id, name: player.name, goals: 1 }];
    });
    setPendingScorerId("");
  };

  const adjustGoals = (id: string, delta: number) => {
    setScorers((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, goals: s.goals + delta } : s))
        .filter((s) => s.goals > 0)
    );
  };

  const removeScorer = (id: string) => {
    setScorers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSave = async () => {
    if (!user) return;
    // Treat empty inputs as 0 — the placeholder shows "0" so users often
    // leave the box blank when their team didn't score.
    const h = homeScore.trim() === "" ? 0 : parseInt(homeScore, 10);
    const a = awayScore.trim() === "" ? 0 : parseInt(awayScore, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      toast({
        title: "Invalid score",
        description: `Please enter valid ${sportConfig.unitPlural} for both teams.`,
        variant: "destructive",
      });
      return;
    }
    if (totalAttributedGoals > h) {
      toast({
        title: "Too many scorers",
        description: `You attributed ${totalAttributedGoals} ${sportConfig.unitPlural} but ${labelHome} scored ${h}.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        team_id: teamId,
        event_id: eventId,
        sport: sportConfig.key,
        home_label: teamName,
        away_label: opponent || "Opponent",
        home_score: h,
        away_score: a,
        period_scores: [],
        player_stats: scorers.map((s) => ({
          id: s.id,
          name: s.name,
          goals: s.goals,
        })) as any,
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

  const savedScorers: PlayerGoalRow[] = Array.isArray(result?.player_stats)
    ? (result!.player_stats as any[])
        .filter((p) => p && (p.goals ?? 0) > 0)
        .map((p) => ({
          id: String(p.id),
          name: String(p.name || "Player"),
          goals: Number(p.goals) || 0,
        }))
    : [];

  const availableToAdd = (roster || []).filter(
    (p) => !scorers.some((s) => s.id === p.id)
  );

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

          {hasScore && savedScorers.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Target className="h-3.5 w-3.5" />
                Goal scorers
              </div>
              <div className="flex flex-wrap gap-1.5">
                {savedScorers.map((s) => (
                  <Badge key={s.id} variant="secondary" className="font-normal">
                    {s.name}
                    {s.goals > 1 && (
                      <span className="ml-1 opacity-70">×{s.goals}</span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6 gap-3 max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-1/2 sm:-translate-y-1/2"
        >
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">{hasScore ? "Edit" : "Record"} Match Score</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-4 px-4 sm:-mx-6 sm:px-6">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-3 py-2">
              <div className="min-w-0">
                <Label htmlFor="home-score" className="text-xs text-muted-foreground truncate block">
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
                  className="text-center text-xl sm:text-2xl font-bold h-12 sm:h-14 mt-1 px-1"
                  placeholder="0"
                />
              </div>
              <div className="pb-3 text-lg sm:text-xl font-bold text-muted-foreground">–</div>
              <div className="min-w-0">
                <Label htmlFor="away-score" className="text-xs text-muted-foreground truncate block">
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
                  className="text-center text-xl sm:text-2xl font-bold h-12 sm:h-14 mt-1 px-1"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Goal scorers */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Target className="h-4 w-4 text-primary" />
                  Goal scorers
                </Label>
                <span
                  className={`text-xs tabular-nums ${
                    overAttributed ? "text-destructive font-medium" : "text-muted-foreground"
                  }`}
                >
                  {totalAttributedGoals}
                  {!isNaN(homeNum) && ` / ${homeNum}`}
                </span>
              </div>

              <div className="flex gap-2">
                <Select value={pendingScorerId} onValueChange={setPendingScorerId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a player…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 z-[1000010]">
                    {!scorers.some((s) => s.id === OWN_GOAL_ID) && (
                      <SelectItem value={OWN_GOAL_ID}>
                        {OWN_GOAL_NAME}
                      </SelectItem>
                    )}
                    {availableToAdd.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        {roster?.length ? "All players added" : "No players found"}
                      </div>
                    ) : (
                      availableToAdd.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={addScorer}
                  disabled={!pendingScorerId}
                  aria-label="Add scorer"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {scorers.length > 0 ? (
                <div className="space-y-1.5">
                  {scorers.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-md border p-2"
                    >
                      <span className="flex-1 text-sm truncate">{s.name}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => adjustGoals(s.id, -1)}
                          aria-label="Remove one goal"
                        >
                          –
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">
                          {s.goals}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => adjustGoals(s.id, +1)}
                          aria-label="Add one goal"
                        >
                          +
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => removeScorer(s.id)}
                          aria-label="Remove scorer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional — attribute goals to players to track top scorers.
                </p>
              )}

              {overAttributed && (
                <p className="text-xs text-destructive">
                  You've attributed more goals than {labelHome} scored.
                </p>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="pt-3 flex-row gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || overAttributed} className="flex-1 sm:flex-none">
              {saving ? "Saving…" : "Save score"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
