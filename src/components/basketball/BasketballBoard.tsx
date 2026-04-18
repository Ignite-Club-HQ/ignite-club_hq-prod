import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Repeat, Trophy, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LinkedEventHeader } from "@/components/pitch/LinkedEventHeader";
import { SyncStatusIndicator } from "@/components/pitch/SyncStatusIndicator";

import BasketballQuarterTimer from "./BasketballQuarterTimer";
import BasketballActionBar from "./BasketballActionBar";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";
import BasketballQuarterBreakDialog from "./BasketballQuarterBreakDialog";
import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import TimeoutsPanel from "@/components/scoreboard/TimeoutsPanel";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import MomentumStrip from "@/components/scoreboard/MomentumStrip";
import FoulFatigueWatchlist from "@/components/scoreboard/FoulFatigueWatchlist";
import SmartSubSuggestion from "@/components/scoreboard/SmartSubSuggestion";
import CuesToggle from "@/components/scoreboard/CuesToggle";
import { useBasketballBoardState } from "@/hooks/useBasketballBoardState";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useSaveGameResult } from "@/hooks/useSaveGameResult";
import { useCourtBoardDefaults } from "@/hooks/useCourtBoardDefaults";
import { useCourtSpectator } from "@/hooks/useCourtSpectator";

// Lazy-load secondary dialogs
const BasketballSettingsDialog = lazy(() => import("./BasketballSettingsDialog"));
const BasketballQuarterLineupPlanner = lazy(() => import("./BasketballQuarterLineupPlanner"));
const BasketballRosterDialog = lazy(() => import("./BasketballRosterDialog"));
const BasketballQuickActionSheet = lazy(() => import("./BasketballQuickActionSheet"));
const BasketballLineupPresetsDialog = lazy(() => import("./BasketballLineupPresetsDialog"));
const FreeThrowDialog = lazy(() => import("./FreeThrowDialog"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));
const QuarterAutoSubControlPanel = lazy(() => import("@/components/scoreboard/QuarterAutoSubControlPanel"));
import PreTipoffHint from "@/components/scoreboard/PreTipoffHint";

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
  /**
   * Spectator mode — when true, the board polls the coach's published state
   * via `useCourtSpectator` and renders it read-only. No notifications, no
   * sync writes, no game-summary save. Forces `readOnly` regardless of prop.
   */
  spectator?: boolean;
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
  spectator = false,
}: BasketballBoardProps) {
  // Spectator mode is always read-only (regardless of caller's readOnly flag)
  // and pulls live state from the coach's `active_games` row.
  const effectiveReadOnly = readOnly || spectator;
  const spectatorFeed = useCourtSpectator({
    teamId,
    sport: "basketball",
    enabled: spectator,
  });
  const spectatorState = spectator
    ? {
        players:
          (spectatorFeed.pitchState as { players?: typeof members extends Array<infer _> ? unknown : never } | null)?.players as never,
        timerState: spectatorFeed.timerState as never,
        rotationMode: (spectatorFeed.pitchState as { rotationMode?: never } | null)?.rotationMode,
        rotationIntervalMinutes: (spectatorFeed.pitchState as { rotationIntervalMinutes?: number } | null)
          ?.rotationIntervalMinutes,
        validationMode: (spectatorFeed.pitchState as { validationMode?: never } | null)?.validationMode,
        autoSubPlan: (spectatorFeed.pitchState as { autoSubPlan?: never } | null)?.autoSubPlan,
        quarterLineups: (spectatorFeed.pitchState as { quarterLineups?: never } | null)?.quarterLineups,
      }
    : null;

  const board = useBasketballBoardState({
    teamId,
    members,
    readOnly: effectiveReadOnly,
    initialMinutesPerQuarter,
    eventId,
    spectatorState,
  });

  // Per-team default board settings (minutes, rotation, validation, period type, timeouts).
  // Loaded once from `team_subscriptions.court_*`; in-game changes persist back via the
  // settings dialog handlers below.
  const { defaults, isLoading: defaultsLoading, persist: persistDefaults } =
    useCourtBoardDefaults(teamId, effectiveReadOnly);
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultsLoading || defaultsAppliedRef.current) return;
    defaultsAppliedRef.current = true;
    if (defaults.minutesPerQuarter != null) {
      board.setTimerState((s) => ({
        ...s,
        minutesPerQuarter: defaults.minutesPerQuarter!,
        lastUpdateTime: Date.now(),
      }));
    }
    if (defaults.rotationMode) board.setRotationMode(defaults.rotationMode);
    if (defaults.rotationIntervalMinutes != null)
      board.setRotationIntervalMinutes(defaults.rotationIntervalMinutes);
    if (defaults.validationMode === "free" || defaults.validationMode === "structured") {
      board.setValidationMode(defaults.validationMode);
    }
    if (defaults.periodType) board.setPeriodType(defaults.periodType);
    if (defaults.timeoutsPerHalf != null) board.setTimeoutsPerHalf(defaults.timeoutsPerHalf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsLoading]);

  // Local UI-only state for which secondary dialog is open.
  // Kept here (not in the hook) so the hook stays focused on game logic.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineupPlannerOpen, setLineupPlannerOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  const [freeThrowSession, setFreeThrowSession] = useState<{
    playerId: string;
    playerName: string;
    attempts: 1 | 2 | 3;
  } | null>(null);

  // Linked event lifecycle (mirrors soccer pitch board behaviour).
  const [linkedEventId, setLinkedEventId] = useState<string | null>(eventId);
  useEffect(() => {
    setLinkedEventId(eventId);
  }, [eventId]);

  // Pull opponent + title from the linked event so the scoreboard auto-labels.
  const { data: linkedEvent } = useQuery({
    queryKey: ["basketball-linked-event", linkedEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, opponent, title")
        .eq("id", linkedEventId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!linkedEventId,
    staleTime: 5 * 60 * 1000,
  });

  // Default the opponent name from the linked event once, if the coach hasn't set one.
  useEffect(() => {
    if (!linkedEvent?.opponent) return;
    const current = board.timerState.opponentName;
    if (!current || current === "Opponent") {
      board.setOpponentName(linkedEvent.opponent);
    }
  }, [linkedEvent?.opponent, board]);

  const { save: saveGameResult, saved: gameSaved } = useSaveGameResult();

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
  useWakeLock(!effectiveReadOnly && board.timerState.isRunning && !board.timerState.isGameFinished);

  // Auto-save the finished game to history (admins/coaches only — RLS guards the rest).
  useEffect(() => {
    if (!effectiveReadOnly && board.timerState.isGameFinished) {
      saveGameResult({
        teamId,
        eventId,
        sport: "basketball",
        homeLabel: teamName,
        awayLabel: board.timerState.opponentName ?? "Opponent",
        homeScore: board.timerState.homeScore ?? 0,
        awayScore: board.timerState.awayScore ?? 0,
        perQuarter,
        players: summaryPlayers,
        mvpPlayerId: board.timerState.mvpPlayerId ?? null,
      });
    }
  }, [
    effectiveReadOnly,
    board.timerState.isGameFinished,
    board.timerState.mvpPlayerId,
    teamId,
    eventId,
    teamName,
    board.timerState.opponentName,
    board.timerState.homeScore,
    board.timerState.awayScore,
    perQuarter,
    summaryPlayers,
    saveGameResult,
  ]);

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
        <SyncStatusIndicator />
        <CuesToggle />
        <BasketballQuarterTimer
          state={board.timerState}
          onChange={board.setTimerState}
          onTick={board.handleTick}
          onQuarterEnd={board.handleQuarterEnd}
          readOnly={effectiveReadOnly}
        />
      </header>

      {/* Linked event header (link/unlink a scheduled match). */}
      <LinkedEventHeader
        eventId={linkedEventId || ""}
        teamId={teamId}
        teamName={teamName}
        compact
        onLinkEvent={effectiveReadOnly ? undefined : setLinkedEventId}
        currentScore={{
          team: board.timerState.homeScore ?? 0,
          opponent: board.timerState.awayScore ?? 0,
        }}
        isGameInProgress={!!board.timerState.isRunning && !board.timerState.isGameFinished}
      />

      <GameScoreboard
        homeLabel={teamName}
        awayLabel={board.timerState.opponentName ?? "Opponent"}
        homeScore={board.timerState.homeScore ?? 0}
        awayScore={board.timerState.awayScore ?? 0}
        increments={[1, 2, 3]}
        readOnly={effectiveReadOnly}
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

      <TimeoutsPanel
        homeLabel={teamName}
        awayLabel={board.timerState.opponentName ?? "Opponent"}
        homeRemaining={
          board.timerState.homeTimeoutsRemaining ?? board.timerState.timeoutsPerHalf ?? 3
        }
        awayRemaining={
          board.timerState.awayTimeoutsRemaining ?? board.timerState.timeoutsPerHalf ?? 3
        }
        perHalf={board.timerState.timeoutsPerHalf ?? 3}
        half={board.timerState.currentQuarter <= 2 ? 1 : 2}
        readOnly={effectiveReadOnly}
        onCall={board.callTimeout}
        onResetHalf={board.resetTimeoutsForCurrentHalf}
      />

      <BenchFairnessMeter
        players={board.players}
        elapsedSeconds={
          board.timerState.elapsedSeconds +
          (board.timerState.currentQuarter - 1) * board.timerState.minutesPerQuarter * 60
        }
      />

      <MomentumStrip scoreLog={board.timerState.scoreLog} />

      <FoulFatigueWatchlist
        sport="basketball"
        players={board.players}
        currentQuarter={board.timerState.currentQuarter}
        totalElapsedSeconds={
          board.timerState.elapsedSeconds +
          (board.timerState.currentQuarter - 1) * board.timerState.minutesPerQuarter * 60
        }
        minutesPerQuarter={board.timerState.minutesPerQuarter}
      />

      {!effectiveReadOnly && (
        <SmartSubSuggestion
          players={board.players}
          totalElapsedSeconds={
            board.timerState.elapsedSeconds +
            (board.timerState.currentQuarter - 1) * board.timerState.minutesPerQuarter * 60
          }
          isRunning={board.timerState.isRunning && !board.timerState.isGameFinished}
          onApplySub={(outId, inId) => board.performSwap(outId, inId)}
        />
      )}

      {!effectiveReadOnly && (
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

      {/* Pre-tipoff nudge: only before the very first whistle. */}
      {!effectiveReadOnly &&
        board.timerState.currentQuarter === 1 &&
        board.timerState.elapsedSeconds === 0 &&
        !board.timerState.isRunning &&
        !board.timerState.isGameFinished && (
          <PreTipoffHint
            required={5}
            currentOnCourt={board.players.filter((p) => p.position !== null).length}
            onOpenPlanner={() => setLineupPlannerOpen(true)}
            onOpenPresets={() => setPresetsOpen(true)}
            hasPresets={board.lineupPresets.length > 0}
          />
        )}

      {!effectiveReadOnly && board.rotationMode !== "off" && board.autoSubPlan.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-primary/5">
          <span className="text-[11px] text-muted-foreground">
            Auto-subs: {board.autoSubPlan.filter((s) => s.executed).length}/{board.autoSubPlan.length}
            {board.autoSubPaused && <span className="ml-1.5 text-amber-600 font-medium">· Paused</span>}
            {board.lockedPlayerIds.size > 0 && (
              <span className="ml-1.5 text-amber-600">· {board.lockedPlayerIds.size} locked</span>
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setAutoSubPanelOpen(true)}
          >
            <Repeat className="h-3.5 w-3.5" />
            Subs Plan
          </Button>
        </div>
      )}

      <BasketballCourtArea
        players={board.players}
        selectedPlayerId={board.selectedPlayerId}
        nextSubOutId={board.nextSub?.playerOut.id ?? null}
        readOnly={effectiveReadOnly}
        courtView={board.courtView}
        onPlayerClick={board.handlePlayerClick}
        onSlotClick={board.handleSlotClick}
      />

      <BasketballBench
        bench={board.bench}
        selectedPlayerId={board.selectedPlayerId}
        nextSubInId={board.nextSub?.playerIn.id ?? null}
        readOnly={effectiveReadOnly}
        onPlayerClick={board.handlePlayerClick}
      />

      {!effectiveReadOnly && (board.canUndoSub || (board.timerState.scoreLog?.length ?? 0) > 0) && (
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
            onMinutesPerQuarterChange={(n) => {
              board.setTimerState((s) => ({
                ...s,
                minutesPerQuarter: n,
                lastUpdateTime: Date.now(),
              }));
              persistDefaults({ court_minutes_per_quarter: n });
            }}
            rotationMode={board.rotationMode}
            onRotationModeChange={(m) => {
              board.setRotationMode(m);
              persistDefaults({ court_rotation_mode: m });
            }}
            rotationIntervalMinutes={board.rotationIntervalMinutes}
            onRotationIntervalChange={(n) => {
              board.setRotationIntervalMinutes(n);
              persistDefaults({ court_rotation_interval_minutes: n });
            }}
            validationMode={board.validationMode}
            onValidationModeChange={(m) => {
              board.setValidationMode(m);
              persistDefaults({ court_validation_mode: m });
            }}
            timeoutsPerHalf={board.timerState.timeoutsPerHalf ?? 3}
            onTimeoutsPerHalfChange={(n) => {
              board.setTimeoutsPerHalf(n);
              persistDefaults({ court_timeouts_per_half: n });
            }}
            periodType={board.timerState.periodType ?? "quarters"}
            onPeriodTypeChange={(p) => {
              board.setPeriodType(p);
              persistDefaults({ court_period_type: p });
            }}
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
            onFreeThrows={(attempts) =>
              setFreeThrowSession({
                playerId: board.quickActionPlayer!.id,
                playerName: board.quickActionPlayer!.name,
                attempts,
              })
            }
          />
        )}
        {freeThrowSession && (
          <FreeThrowDialog
            open={!!freeThrowSession}
            onOpenChange={(o) => !o && setFreeThrowSession(null)}
            playerName={freeThrowSession.playerName}
            attempts={freeThrowSession.attempts}
            onComplete={(made, attempted) =>
              board.addFreeThrows(freeThrowSession.playerId, made, attempted)
            }
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
            readOnly={effectiveReadOnly}
            isSaved={gameSaved}
            onSaveNow={() =>
              saveGameResult(
                {
                  teamId,
                  eventId,
                  sport: "basketball",
                  homeLabel: teamName,
                  awayLabel: board.timerState.opponentName ?? "Opponent",
                  homeScore: board.timerState.homeScore ?? 0,
                  awayScore: board.timerState.awayScore ?? 0,
                  perQuarter,
                  players: summaryPlayers,
                  mvpPlayerId: board.timerState.mvpPlayerId ?? null,
                },
                { force: true }
              )
            }
          />
        )}
        {autoSubPanelOpen && (
          <QuarterAutoSubControlPanel
            open={autoSubPanelOpen}
            onClose={() => setAutoSubPanelOpen(false)}
            autoSubPlan={board.autoSubPlan}
            onPlayers={board.players.filter((p) => p.position !== null) as any}
            currentQuarter={board.timerState.currentQuarter}
            currentElapsedSeconds={board.timerState.elapsedSeconds}
            minutesPerQuarter={board.timerState.minutesPerQuarter}
            periodType={board.timerState.periodType ?? "quarters"}
            autoSubPaused={board.autoSubPaused}
            lockedPlayerIds={board.lockedPlayerIds}
            onTogglePause={board.toggleAutoSubPaused}
            onExecuteNow={board.executeNextSubNow}
            onSkipNext={board.skipNextSub}
            onCancelPlan={board.cancelAutoSubPlan}
            onRegeneratePlan={board.regenerateAutoSubPlan}
            onToggleLockPlayer={board.toggleLockPlayer}
          />
        )}
      </Suspense>
    </div>
  );
}
