import { useMemo, useState } from "react";
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
import { Trophy, Trash2, Calendar, Star, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { lazy, Suspense } from "react";
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
}

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

  const { data, isLoading } = useQuery({
    queryKey: ["game_results", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_results")
        .select("*")
        .eq("team_id", teamId)
        .order("played_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as GameResultRow[];
    },
  });

  const grouped = useMemo(() => {
    if (!data) return [];
    return data;
  }, [data]);

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

  if (!grouped.length) {
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

  return (
    <div className="space-y-2">
      {grouped.map((row) => {
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
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${resultClass}`}>
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
      })}

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
