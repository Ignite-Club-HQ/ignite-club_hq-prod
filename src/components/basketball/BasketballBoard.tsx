import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Trophy, Undo2 } from "lucide-react";

import BasketballQuarterTimer from "./BasketballQuarterTimer";
import BasketballActionBar from "./BasketballActionBar";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";
import BasketballQuarterBreakDialog from "./BasketballQuarterBreakDialog";
import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import TimeoutsPanel from "@/components/scoreboard/TimeoutsPanel";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import CuesToggle from "@/components/scoreboard/CuesToggle";
import { useBasketballBoardState } from "@/hooks/useBasketballBoardState";
import { useWakeLock } from "@/hooks/useWakeLock";

// Lazy-load secondary dialogs
const BasketballSettingsDialog = lazy(() => import("./BasketballSettingsDialog"));
const BasketballQuarterLineupPlanner = lazy(() => import("./BasketballQuarterLineupPlanner"));
const BasketballRosterDialog = lazy(() => import("./BasketballRosterDialog"));
const BasketballQuickActionSheet = lazy(() => import("./BasketballQuickActionSheet"));
const BasketballLineupPresetsDialog = lazy(() => import("./BasketballLineupPresetsDialog"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));

interface BasketballBoardProps {
  teamId: string;
  teamName: string;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
  onClose: () => void;
  readOnly?: boolean;
  initialMinutesPerQuarter?: number;
  /** When provided, board state is scoped to this event (no collisions across matches). */
  eventId?: string | null;
}

const DialogLoader = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-5 w-5 animate-spin text-primary" />
  </div>
);

export default function BasketballBoard({
  teamId,
  teamName,
  members,
  onClose,
  readOnly = false,
  initialMinutesPerQuarter = 10,
  eventId = null,
}: BasketballBoardProps) {
  const board = useBasketballBoardState({
    teamId,
    members,
    readOnly,
    initialMinutesPerQuarter,
    eventId,
  });

  // Local UI-only state for which secondary dialog is open.
  // Kept here (not in the hook) so the hook stays focused on game logic.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineupPlannerOpen, setLineupPlannerOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Auto-open the summary the first time the game ticks over to "finished".
  useEffect(() => {
    if (board.timerState.isGameFinished) setSummaryOpen(true);
  }, [board.timerState.isGameFinished]);

  // Build sport-agnostic player rows for the summary dialog.
  const summaryPlayers = useMemo(
    () =>
      board.players.map((p) => ({
        id: p.id,
        name: p.name,
        secondsPlayed: p.minutesPlayed ?? 0,
        points: p.points ?? 0,
        fouls: p.fouls ?? 0,
        isFouledOut: !!p.isFouledOut,
        isInjured: !!p.isInjured,
        finalPosition: p.position ?? null,
      })),
    [board.players]
  );

  const perQuarter = useMemo(() => {
    const log = board.timerState.scoreLog ?? [];
    return [1, 2, 3, 4].map((q) => ({
      quarter: q,
      home: log
        .filter((e) => e.quarter === q && e.side === "home")
        .reduce((sum, e) => sum + e.points, 0),
      away: log
        .filter((e) => e.quarter === q && e.side === "away")
        .reduce((sum, e) => sum + e.points, 0),
    }));
  }, [board.timerState.scoreLog]);

  // Keep the screen awake while a coach is actively running the game.
  useWakeLock(!readOnly && board.timerState.isRunning && !board.timerState.isGameFinished);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 p-2 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm truncate">{teamName}</h1>
          <p className="text-[10px] text-muted-foreground">Basketball Game Board</p>
        </div>
        <BasketballQuarterTimer
          state={board.timerState}
          onChange={board.setTimerState}
          onTick={board.handleTick}
          onQuarterEnd={board.handleQuarterEnd}
          readOnly={readOnly}
        />
      </header>

      <GameScoreboard
        homeLabel={teamName}
        awayLabel={board.timerState.opponentName ?? "Opponent"}
        homeScore={board.timerState.homeScore ?? 0}
        awayScore={board.timerState.awayScore ?? 0}
        increments={[1, 2, 3]}
        readOnly={readOnly}
        disabled={!!board.timerState.isGameFinished}
        onScore={board.addScore}
        onUndo={board.undoScore}
        onRenameAway={board.setOpponentName}
        canUndo={(board.timerState.scoreLog?.length ?? 0) > 0}
      />

      <QuarterScoreStrip
        scoreLog={board.timerState.scoreLog}
        currentQuarter={board.timerState.currentQuarter}
      />

      {!readOnly && (
        <BasketballActionBar
          onOpenSquad={() => setRosterOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          onApplyLineup={board.applyNextLineupNow}
          onToggleCourtView={board.toggleCourtView}
          currentQuarter={board.timerState.currentQuarter}
          rotationMode={board.rotationMode}
          rotationIntervalMinutes={board.rotationIntervalMinutes}
          courtView={board.courtView}
        />
      )}

      <BasketballCourtArea
        players={board.players}
        selectedPlayerId={board.selectedPlayerId}
        nextSubOutId={board.nextSub?.playerOut.id ?? null}
        readOnly={readOnly}
        courtView={board.courtView}
        onPlayerClick={board.handlePlayerClick}
        onSlotClick={board.handleSlotClick}
      />

      <BasketballBench
        bench={board.bench}
        selectedPlayerId={board.selectedPlayerId}
        nextSubInId={board.nextSub?.playerIn.id ?? null}
        readOnly={readOnly}
        onPlayerClick={board.handlePlayerClick}
      />

      {!readOnly && (board.canUndoSub || (board.timerState.scoreLog?.length ?? 0) > 0) && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={board.undoLastSub}
            disabled={!board.canUndoSub}
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Undo last sub
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setSummaryOpen(true)}
          >
            <Trophy className="h-3.5 w-3.5 mr-1" />
            Game summary
          </Button>
        </div>
      )}

      <BasketballQuarterBreakDialog
        open={!!board.pendingQuarterSubs}
        quarter={board.pendingQuarterSubs?.quarter ?? null}
        subs={board.pendingQuarterSubs?.subs ?? []}
        onConfirm={board.confirmPendingQuarterSubs}
        onSkip={board.skipPendingQuarterSubs}
      />

      <Suspense fallback={<DialogLoader />}>
        {settingsOpen && (
          <BasketballSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            minutesPerQuarter={board.timerState.minutesPerQuarter}
            onMinutesPerQuarterChange={(n) =>
              board.setTimerState((s) => ({
                ...s,
                minutesPerQuarter: n,
                lastUpdateTime: Date.now(),
              }))
            }
            rotationMode={board.rotationMode}
            onRotationModeChange={board.setRotationMode}
            rotationIntervalMinutes={board.rotationIntervalMinutes}
            onRotationIntervalChange={board.setRotationIntervalMinutes}
            validationMode={board.validationMode}
            onValidationModeChange={board.setValidationMode}
          />
        )}
        {lineupPlannerOpen && (
          <BasketballQuarterLineupPlanner
            open={lineupPlannerOpen}
            onOpenChange={setLineupPlannerOpen}
            players={board.players}
            lineups={board.quarterLineups}
            onSave={board.setQuarterLineups}
          />
        )}
        {rosterOpen && (
          <BasketballRosterDialog
            open={rosterOpen}
            onOpenChange={setRosterOpen}
            players={board.players}
            onSave={board.setPlayers}
          />
        )}
        {presetsOpen && (
          <BasketballLineupPresetsDialog
            open={presetsOpen}
            onOpenChange={setPresetsOpen}
            players={board.players}
            presets={board.lineupPresets}
            onSave={board.setLineupPresets}
            onApply={board.applyPreset}
          />
        )}
        {board.quickActionPlayerId && board.quickActionPlayer && (
          <BasketballQuickActionSheet
            open={!!board.quickActionPlayerId}
            onOpenChange={(o) => !o && board.setQuickActionPlayerId(null)}
            player={board.quickActionPlayer}
            onStartSwap={() => board.setSelectedPlayerId(board.quickActionPlayer!.id)}
            onSubOff={() => board.subOff(board.quickActionPlayer!.id)}
            onSubOn={() => board.setSelectedPlayerId(board.quickActionPlayer!.id)}
            onToggleInjured={() => board.toggleInjured(board.quickActionPlayer!.id)}
            onAddFoul={() => board.addFoul(board.quickActionPlayer!.id)}
            onClearFoulOut={() => board.clearFoulOut(board.quickActionPlayer!.id)}
            onScore={(pts) => board.addScore("home", pts, board.quickActionPlayer!.id)}
          />
        )}
        {summaryOpen && (
          <GameSummaryDialog
            open={summaryOpen}
            onOpenChange={setSummaryOpen}
            sport="basketball"
            homeLabel={teamName}
            awayLabel={board.timerState.opponentName ?? "Opponent"}
            homeScore={board.timerState.homeScore ?? 0}
            awayScore={board.timerState.awayScore ?? 0}
            perQuarter={perQuarter}
            players={summaryPlayers}
            mvpPlayerId={board.timerState.mvpPlayerId ?? null}
            onSelectMvp={board.setMvp}
            readOnly={readOnly}
          />
        )}
      </Suspense>
    </div>
  );
}
