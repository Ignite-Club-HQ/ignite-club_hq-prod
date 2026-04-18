import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import CentrePassIndicator from "@/components/scoreboard/CentrePassIndicator";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import MomentumStrip from "@/components/scoreboard/MomentumStrip";
import FoulFatigueWatchlist from "@/components/scoreboard/FoulFatigueWatchlist";

import NetballCourtArea from "@/components/netball/NetballCourtArea";
import NetballBench from "@/components/netball/NetballBench";
import { getBench } from "@/components/netball/netballHelpers";
import type {
  NetballBoardState,
  NetballPlayer,
  NetballTimerState,
} from "@/components/netball/types";
import { isSpectatorFeedStale } from "@/components/scoreboard/spectatorTypes";
import { totalElapsedSeconds, periodLabel } from "@/lib/periodTypes";

interface NetballSpectatorViewProps {
  teamName: string;
  board: Partial<NetballBoardState>;
  timer: Partial<NetballTimerState>;
  receivedAt: number;
  onClose: () => void;
}

const formatClock = (totalSeconds: number, minutesPerQuarter: number) => {
  const remaining = Math.max(0, minutesPerQuarter * 60 - totalSeconds);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Lean read-only netball board for spectators.
 *
 * Renders the same visual sub-components the coach sees, but driven entirely
 * by the projected `active_games` payload — no internal state machine, no
 * localStorage, no auto-sub recalculation, no sync writes.
 */
export default function NetballSpectatorView({
  teamName,
  board,
  timer,
  receivedAt,
  onClose,
}: NetballSpectatorViewProps) {
  const players = (board.players ?? []) as NetballPlayer[];
  const bench = useMemo(() => getBench(players), [players]);
  const minutesPerQuarter = timer.minutesPerQuarter ?? 15;
  const currentQuarter = (timer.currentQuarter ?? 1) as 1 | 2 | 3 | 4;
  const elapsedSeconds = timer.elapsedSeconds ?? 0;
  const periodType = timer.periodType ?? "quarters";
  const totalElapsed = totalElapsedSeconds(currentQuarter, elapsedSeconds, minutesPerQuarter, periodType);

  // Tick once a second so the "feed stale" indicator flips automatically.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const stale = isSpectatorFeedStale(receivedAt);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between gap-2 p-2 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm truncate">{teamName}</h1>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Eye className="h-3 w-3" />
            Watching live · Netball
          </p>
        </div>
        <div
          className={cn(
            "flex flex-col items-end gap-0.5 rounded-md px-2 py-1",
            stale ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary"
          )}
        >
          <span className="text-[9px] uppercase tracking-wide font-semibold">
            Q{currentQuarter}
          </span>
          <span className="text-sm font-black tabular-nums">
            {formatClock(elapsedSeconds, minutesPerQuarter)}
          </span>
        </div>
      </header>

      {stale && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b text-[11px] text-amber-700 dark:text-amber-300">
          <WifiOff className="h-3 w-3" />
          Coach's feed paused — showing the last update.
        </div>
      )}

      <GameScoreboard
        homeLabel={teamName}
        awayLabel={timer.opponentName ?? "Opponent"}
        homeScore={timer.homeScore ?? 0}
        awayScore={timer.awayScore ?? 0}
        increments={[1]}
        readOnly
        disabled
        onScore={() => {}}
        onUndo={() => {}}
        onRenameAway={() => {}}
        canUndo={false}
      />

      <QuarterScoreStrip
        scoreLog={timer.scoreLog}
        currentQuarter={currentQuarter}
        periodType={periodType}
      />

      <CentrePassIndicator
        homeLabel={teamName}
        awayLabel={timer.opponentName ?? "Opponent"}
        side={timer.centrePass ?? "home"}
        readOnly
        onSwap={() => {}}
      />

      <BenchFairnessMeter players={players} elapsedSeconds={totalElapsed} />

      <MomentumStrip scoreLog={timer.scoreLog} />

      <FoulFatigueWatchlist
        sport="netball"
        players={players}
        currentQuarter={currentQuarter}
        totalElapsedSeconds={totalElapsed}
        minutesPerQuarter={minutesPerQuarter}
      />

      <NetballCourtArea
        players={players}
        selectedPlayerId={null}
        readOnly
        onPlayerClick={() => {}}
        onSlotClick={() => {}}
      />

      <NetballBench
        bench={bench}
        selectedPlayerId={null}
        readOnly
        onPlayerClick={() => {}}
      />
    </div>
  );
}
