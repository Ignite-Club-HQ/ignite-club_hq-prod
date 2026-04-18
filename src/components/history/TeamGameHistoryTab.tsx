import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trophy, Trash2, Calendar, Star, Loader2, CalendarDays, Crown } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { SummaryPlayerStat, PerQuarterScore } from "@/components/scoreboard/GameSummaryDialog";

const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));

interface TeamGameHistoryTabProps {
  teamId: string;
  teamName: string;
  /** Whether the viewer can delete saved games. */
  canManage: boolean;
}

interface GameResultRow {
  id: string;
  team_id: string;
  event_id: string | null;
  sport: "basketball" | "netball";
  home_label: string;
  away_label: string;
  home_score: number;
  away_score: number;
  period_scores: PerQuarterScore[];
  player_stats: SummaryPlayerStat[];
  mvp_player_id: string | null;
  mvp_player_name: string | null;
  played_at: string;
  saved_by: string;
  events?: { id: string; title: string | null; start_time: string | null } | null;
}

type SportFilter = "all" | "basketball" | "netball";

const sportLabel = (s: string) => (s === "basketball" ? "Basketball" : "Netball");

export default function TeamGameHistoryTab({
  teamId,
  teamName,
  canManage,
}: TeamGameHistoryTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openRow, setOpenRow] = useState<GameResultRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GameResultRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["game_results", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_results")
        .select("*, events:event_id ( id, title, start_time )")
        .eq("team_id", teamId)
        .order("played_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as GameResultRow[];
    },
  });

  const counts = useMemo(() => {
    const all = data?.length ?? 0;
    const basketball = data?.filter((r) => r.sport === "basketball").length ?? 0;
    const netball = data?.filter((r) => r.sport === "netball").length ?? 0;
    return { all, basketball, netball };
  }, [data]);

  /**
   * Season-level aggregates over the (filtered) game list. Surfaces the
   * coach's bird's-eye view: record, points-for/against differential, and the
   * stand-out scorer across all games.
   */
  const aggregates = useMemo(() => {
    const rows = data ?? [];
    if (rows.length === 0) return null;
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let pointsFor = 0;
    let pointsAgainst = 0;
    const scorerTotals = new Map<string, { name: string; points: number }>();
    for (const r of rows) {
      if (r.home_score > r.away_score) wins++;
      else if (r.home_score < r.away_score) losses++;
      else draws++;
      pointsFor += r.home_score;
      pointsAgainst += r.away_score;
      for (const p of r.player_stats ?? []) {
        const pts = p.points ?? 0;
        if (pts <= 0) continue;
        const prev = scorerTotals.get(p.id) ?? { name: p.name, points: 0 };
        prev.points += pts;
        prev.name = p.name; // refresh in case display name changed
        scorerTotals.set(p.id, prev);
      }
    }
    const topScorer = [...scorerTotals.values()].sort((a, b) => b.points - a.points)[0] ?? null;
    return {
      wins,
      losses,
      draws,
      pointsFor,
      pointsAgainst,
      diff: pointsFor - pointsAgainst,
      topScorer,
    };
  }, [data]);


  const visible = useMemo(() => {
    if (!data) return [];
    if (sportFilter === "all") return data;
    return data.filter((r) => r.sport === sportFilter);
  }, [data, sportFilter]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("game_results")
        .delete()
        .eq("id", confirmDelete.id);
      if (error) throw error;
      toast({ title: "Deleted", description: "Game removed from history." });
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["game_results", teamId] });
    } catch (e) {
      toast({
        title: "Could not delete",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium">No saved games yet</p>
          <p className="text-xs text-muted-foreground">
            Finished basketball and netball games will appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  const showFilter = counts.basketball > 0 && counts.netball > 0;

  return (
    <div className="space-y-2">
      {/* Season-at-a-glance — only when there's enough signal to be useful. */}
      {aggregates && aggregates.wins + aggregates.losses + aggregates.draws > 0 && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Season so far
              </p>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {aggregates.wins + aggregates.losses + aggregates.draws} games
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Record</p>
                <p className="text-sm font-bold tabular-nums">
                  <span className="text-primary">{aggregates.wins}</span>
                  <span className="text-muted-foreground">–</span>
                  <span className="text-destructive">{aggregates.losses}</span>
                  {aggregates.draws > 0 && (
                    <>
                      <span className="text-muted-foreground">–</span>
                      <span className="text-muted-foreground">{aggregates.draws}</span>
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Points</p>
                <p className="text-sm font-bold tabular-nums">
                  {aggregates.pointsFor}
                  <span className="text-muted-foreground">–</span>
                  {aggregates.pointsAgainst}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Diff</p>
                <p
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    aggregates.diff > 0
                      ? "text-primary"
                      : aggregates.diff < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  )}
                >
                  {aggregates.diff > 0 ? "+" : ""}
                  {aggregates.diff}
                </p>
              </div>
            </div>
            {aggregates.topScorer && (
              <div className="flex items-center gap-2 pt-1.5 border-t border-border/50">
                <Crown className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
                  <p className="text-xs truncate">
                    <span className="text-muted-foreground">Leading scorer · </span>
                    <span className="font-semibold">{aggregates.topScorer.name}</span>
                  </p>
                  <p className="text-xs font-bold tabular-nums text-primary shrink-0">
                    {aggregates.topScorer.points}
                    <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                      pts
                    </span>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showFilter && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              { id: "all" as const, label: "All", count: counts.all },
              { id: "basketball" as const, label: "Basketball", count: counts.basketball },
              { id: "netball" as const, label: "Netball", count: counts.netball },
            ] satisfies { id: SportFilter; label: string; count: number }[]
          ).map((chip) => (
            <Button
              key={chip.id}
              type="button"
              variant={sportFilter === chip.id ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs whitespace-nowrap"
              onClick={() => setSportFilter(chip.id)}
            >
              {chip.label}
              <span className="ml-1.5 text-[10px] opacity-70">{chip.count}</span>
            </Button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No {sportFilter} games saved yet.
        </p>
      ) : (
        visible.map((row) => {
          const result =
            row.home_score > row.away_score
              ? "WIN"
              : row.home_score < row.away_score
                ? "LOSS"
                : "DRAW";
          const resultClass =
            result === "WIN"
              ? "bg-primary/15 text-primary"
              : result === "LOSS"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground";

          return (
            <Card
              key={row.id}
              className="hover:border-primary/40 transition-colors"
            >
              <CardContent className="p-3">
                <button
                  type="button"
                  onClick={() => setOpenRow(row)}
                  className="w-full text-left flex items-start gap-3"
                  aria-label="View game summary"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                        {sportLabel(row.sport)}
                      </Badge>
                      <span
                        className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                          resultClass
                        )}
                      >
                        {result}
                      </span>
                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(row.played_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm font-semibold truncate">
                      {row.home_label}{" "}
                      <span className="tabular-nums">
                        {row.home_score}–{row.away_score}
                      </span>{" "}
                      {row.away_label}
                    </p>
                    {row.events?.title && (
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 truncate max-w-full">
                        <CalendarDays className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{row.events.title}</span>
                      </p>
                    )}
                    {row.mvp_player_name && (
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <Star className="h-2.5 w-2.5 text-primary fill-primary" />
                        MVP {row.mvp_player_name}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(row.played_at), "EEE d MMM yyyy · h:mm a")}
                    </p>
                  </div>
                </button>
                {canManage && (
                  <div className="flex justify-end pt-1.5 mt-1.5 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(row)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Suspense fallback={null}>
        {openRow && (
          <GameSummaryDialog
            open={!!openRow}
            onOpenChange={(o) => !o && setOpenRow(null)}
            sport={openRow.sport}
            homeLabel={openRow.home_label}
            awayLabel={openRow.away_label}
            homeScore={openRow.home_score}
            awayScore={openRow.away_score}
            perQuarter={openRow.period_scores ?? []}
            players={openRow.player_stats ?? []}
            mvpPlayerId={openRow.mvp_player_id}
            readOnly
          />
        )}
      </Suspense>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved game?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the game from {teamName}'s history.
              The action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
