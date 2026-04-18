import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, WifiOff } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";

import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import TimeoutsPanel from "@/components/scoreboard/TimeoutsPanel";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import MomentumStrip from "@/components/scoreboard/MomentumStrip";
import FoulFatigueWatchlist from "@/components/scoreboard/FoulFatigueWatchlist";

import BasketballCourtArea from "@/components/basketball/BasketballCourtArea";
import BasketballBench from "@/components/basketball/BasketballBench";
import { getBench } from "@/components/basketball/basketballHelpers";
import type {
  BasketballBoardState,
  BasketballPlayer,
  BasketballTimerState,
} from "@/components/basketball/types";
import { isSpectatorFeedStale } from "@/components/scoreboard/spectatorTypes";
import { totalElapsedSeconds, periodLabel } from "@/lib/periodTypes";

interface BasketballSpectatorViewProps {
  teamName: string;
  board: Partial<BasketballBoardState>;
  timer: Partial<BasketballTimerState>;
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
 * Lean read-only basketball board for spectators.
 *
 * Renders the same visual sub-components the coach sees, but driven entirely
 * by the projected `active_games` payload — no internal state machine, no
 * localStorage, no auto-sub recalculation, no sync writes. Coach controls
 * (action bar, settings, lineup planner, undo, smart-sub suggestion) are
 * intentionally omitted.
 */
export default function BasketballSpectatorView({
  teamName,
  board,
  timer,
  receivedAt,
  onClose,
}: BasketballSpectatorViewProps) {
  const players = (board.players ?? []) as BasketballPlayer[];
  const bench = useMemo(() => getBench(players), [players]);
  const minutesPerQuarter = timer.minutesPerQuarter ?? 10;
  const currentQuarter = (timer.currentQuarter ?? 1) as 1 | 2 | 3 | 4;
  const elapsedSeconds = timer.elapsedSeconds ?? 0;
  const periodType = timer.periodType ?? "quarters";
  const totalElapsed = totalElapsedSeconds(currentQuarter, elapsedSeconds, minutesPerQuarter, periodType);

  // Tick once a second so the "feed stale" indicator flips automatically
  // even if no new payload arrives. Cheap (one re-render/sec, only here).
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
            Watching live · Basketball
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
        increments={[1, 2, 3]}
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
      />

      <TimeoutsPanel
        homeLabel={teamName}
        awayLabel={timer.opponentName ?? "Opponent"}
        homeRemaining={timer.homeTimeoutsRemaining ?? timer.timeoutsPerHalf ?? 3}
        awayRemaining={timer.awayTimeoutsRemaining ?? timer.timeoutsPerHalf ?? 3}
        perHalf={timer.timeoutsPerHalf ?? 3}
        half={currentQuarter <= 2 ? 1 : 2}
        readOnly
        onCall={() => {}}
        onResetHalf={() => {}}
      />

      <BenchFairnessMeter players={players} elapsedSeconds={totalElapsed} />

      <MomentumStrip scoreLog={timer.scoreLog} />

      <FoulFatigueWatchlist
        sport="basketball"
        players={players}
        currentQuarter={currentQuarter}
        totalElapsedSeconds={totalElapsed}
        minutesPerQuarter={minutesPerQuarter}
      />

      <BasketballCourtArea
        players={players}
        selectedPlayerId={null}
        readOnly
        courtView="half"
        onPlayerClick={() => {}}
        onSlotClick={() => {}}
      />

      <BasketballBench
        bench={bench}
        selectedPlayerId={null}
        readOnly
        onPlayerClick={() => {}}
      />
    </div>
  );
}
