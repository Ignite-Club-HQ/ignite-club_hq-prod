import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Play, Trophy, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isNetballSport, isBasketballSport } from "@/lib/sportDetection";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "court-board-resume-dismissed";

function loadDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * Surfaces in-progress basketball / netball boards for the current coach so
 * they can rejoin a running game from the home screen with one tap.
 *
 * Source of truth = `active_games` rows where `is_active = true` for the
 * current user. We resolve the team's sport client-side (via the joined
 * `clubs.sport`) so the soccer pitch board — which already has its own
 * `GameTimerWidget` — is intentionally excluded.
 *
 * Tap → navigates to the team detail page with `?openBoard=1`, which the
 * team page already handles to auto-open the right board variant.
 */
export default function CourtBoardResumeCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => loadDismissed());

  const dismissGame = (gameId: string, updatedAt: string) => {
    const next = { ...dismissed, [gameId]: updatedAt };
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {}
  };

  const { data: rows } = useQuery({
    queryKey: ["court-board-resume", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("active_games")
        .select(
          "id, team_id, updated_at, timer_state, teams!inner(id, name, clubs(sport))"
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
    // Refresh every 30s so a freshly started/ended game appears/disappears.
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });

  const items = useMemo(() => {
    return (rows ?? [])
      .map((r: any) => {
        const sport: string | null = r.teams?.clubs?.sport ?? null;
        const isBasketball = isBasketballSport(sport);
        const isNetball = isNetballSport(sport);
        if (!isBasketball && !isNetball) return null;
        const t = r.timer_state ?? {};
        return {
          gameId: r.id as string,
          teamId: r.team_id as string,
          teamName: (r.teams?.name as string) ?? "Team",
          sport: isBasketball ? "basketball" : "netball",
          home: (t.homeScore ?? 0) as number,
          away: (t.awayScore ?? 0) as number,
          opponent: (t.opponentName ?? "Opponent") as string,
          quarter: (t.currentQuarter ?? 1) as number,
          isRunning: !!t.isRunning,
          isFinished: !!t.isGameFinished,
          updatedAt: r.updated_at as string,
        };
      })
      .filter(Boolean) as Array<{
      gameId: string;
      teamId: string;
      teamName: string;
      sport: "basketball" | "netball";
      home: number;
      away: number;
      opponent: string;
      quarter: number;
      isRunning: boolean;
      isFinished: boolean;
      updatedAt: string;
    }>;
  }, [rows]);

  if (items.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                items.some((i) => i.isRunning && !i.isFinished)
                  ? "bg-destructive animate-pulse"
                  : "bg-muted-foreground"
              )}
              aria-hidden
            />
            <h3 className="text-sm font-semibold">
              {items.length === 1 ? "Resume game" : "Resume games"}
            </h3>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {items.length}
          </Badge>
        </div>

        <ul className="space-y-1.5">
          {items.map((g) => (
            <li key={g.gameId}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/teams/${g.teamId}?openBoard=1`, {
                    state: { openBoard: true },
                  })
                }
                className="w-full flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-left hover:bg-accent transition-colors"
                aria-label={`Resume ${g.sport} game for ${g.teamName}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium truncate">{g.teamName}</span>
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1 py-0 h-4 capitalize shrink-0"
                    >
                      {g.sport}
                    </Badge>
                    {g.isFinished && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-4 shrink-0 gap-0.5"
                      >
                        <Trophy className="h-2.5 w-2.5" />
                        FT
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    <span className="font-bold text-foreground">
                      {g.home}–{g.away}
                    </span>
                    <span className="truncate">vs {g.opponent}</span>
                    <span aria-hidden>·</span>
                    <span>Q{g.quarter}</span>
                    {g.isRunning && !g.isFinished && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-destructive font-semibold">LIVE</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 shrink-0 gap-1"
                  asChild
                >
                  <span>
                    <Play className="h-3.5 w-3.5" />
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Button>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
