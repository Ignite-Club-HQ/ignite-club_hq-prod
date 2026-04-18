import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Pencil, Repeat, Trophy, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LinkedEventHeader } from "@/components/pitch/LinkedEventHeader";
import { SyncStatusIndicator } from "@/components/pitch/SyncStatusIndicator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

import BasketballQuarterTimer from "./BasketballQuarterTimer";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";
import BasketballQuarterBreakDialog from "./BasketballQuarterBreakDialog";
import BasketballPreGameScreen from "./BasketballPreGameScreen";
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
import { totalElapsedSeconds, visiblePeriods } from "@/lib/periodTypes";

// Lazy-load secondary dialogs
const BasketballGameSettingsDialog = lazy(() => import("./BasketballGameSettingsDialog"));
const BasketballRosterDialog = lazy(() => import("./BasketballRosterDialog"));
const BasketballQuickActionSheet = lazy(() => import("./BasketballQuickActionSheet"));
const BasketballLineupPresetsDialog = lazy(() => import("./BasketballLineupPresetsDialog"));
const FreeThrowDialog = lazy(() => import("./FreeThrowDialog"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));
const QuarterAutoSubControlPanel = lazy(() => import("@/components/scoreboard/QuarterAutoSubControlPanel"));


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

  // Per-team default board settings (minutes, rotation, validation, period type, timeouts).
  // Loaded once from `team_subscriptions.court_*`; in-game changes persist back via the
  // settings dialog handlers below.
  const { defaults, isLoading: defaultsLoading, persist: persistDefaults } =
    useCourtBoardDefaults(teamId, readOnly);
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
  const [rosterOpen, setRosterOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  // (insights moved into "Game details" collapsible below the bench)
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
    const periods = visiblePeriods(board.timerState.periodType);
    return periods.map((slot, idx) => {
      const matches = (q: number) =>
        board.timerState.periodType === "halves"
          ? idx === 0
            ? q <= 2
            : q >= 3
          : q === slot;
      return {
        quarter: slot,
        home: log
          .filter((e) => matches(e.quarter) && e.side === "home")
          .reduce((sum, e) => sum + e.points, 0),
        away: log
          .filter((e) => matches(e.quarter) && e.side === "away")
          .reduce((sum, e) => sum + e.points, 0),
      };
    });
  }, [board.timerState.scoreLog, board.timerState.periodType]);

  // Keep the screen awake while a coach is actively running the game.
  useWakeLock(!readOnly && board.timerState.isRunning && !board.timerState.isGameFinished);

  // Auto-save the finished game to history (admins/coaches only — RLS guards the rest).
  useEffect(() => {
    if (!readOnly && board.timerState.isGameFinished) {
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
    readOnly,
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

  const totalElapsed = totalElapsedSeconds(
    board.timerState.currentQuarter,
    board.timerState.elapsedSeconds,
    board.timerState.minutesPerQuarter,
    board.timerState.periodType
  );

  const isLive = !!board.timerState.isRunning && !board.timerState.isGameFinished;
  const onCourtCount = board.players.filter((p) => p.position !== null).length;
  const lineupSet = onCourtCount >= 5;
  const opponentName = board.timerState.opponentName ?? "Opponent";
  // Pre-game = before the first whistle AND no scores logged yet.
  // Game-in-progress = anything after first tip-off (running OR paused for a
  // timeout) until finished. We use this — not isLive — to hide setup UI so
  // pausing the clock doesn't suddenly leak "Set starting 5" back on screen.
  const hasGameStarted =
    board.timerState.currentQuarter > 1 ||
    board.timerState.elapsedSeconds > 0 ||
    (board.timerState.scoreLog?.length ?? 0) > 0 ||
    board.timerState.isGameFinished;
  const isPreGame = !hasGameStarted;
  const gameInProgress = hasGameStarted && !board.timerState.isGameFinished;
  const [opponentEditOpen, setOpponentEditOpen] = useState(false);
  const [draftOpponent, setDraftOpponent] = useState(opponentName);
  const [gameDetailsOpen, setGameDetailsOpen] = useState(false);

  // ── PRE-GAME ─────────────────────────────────────────────────────
  // Replace the live UI with a focused checklist screen until the coach
  // taps "Start Game". No timer, no scoreboard, no setup CTAs leaking
  // into a running match.
  if (isPreGame) {
    return (
      <>
        <BasketballPreGameScreen
          teamName={teamName}
          opponentName={opponentName}
          players={board.players}
          bench={board.bench}
          selectedPlayerId={board.selectedPlayerId}
          courtView={board.courtView}
          onPlayerClick={board.handlePlayerClick}
          onSlotClick={board.handleSlotClick}
          minutesPerQuarter={board.timerState.minutesPerQuarter}
          periodType={board.timerState.periodType ?? "quarters"}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSquad={() => setRosterOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          hasPresets={board.lineupPresets.length > 0}
          onStartGame={() =>
            board.setTimerState((s) => ({
              ...s,
              isRunning: true,
              lastUpdateTime: Date.now(),
            }))
          }
          onBack={onClose}
          readOnly={readOnly}
        />

        <Suspense fallback={<DialogLoader />}>
          {settingsOpen && (
            <BasketballGameSettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              periodType={board.timerState.periodType ?? "quarters"}
              onPeriodTypeChange={(p) => {
                board.setPeriodType(p);
                persistDefaults({ court_period_type: p });
              }}
              minutesPerQuarter={board.timerState.minutesPerQuarter}
              onMinutesPerQuarterChange={(n) => {
                board.setTimerState((s) => ({
                  ...s,
                  minutesPerQuarter: n,
                  lastUpdateTime: Date.now(),
                }));
                persistDefaults({ court_minutes_per_quarter: n });
              }}
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
        </Suspense>
      </>
    );
  }

  // ── LIVE / FINISHED ──────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* ── Header — back, matchup, sync ── */}
      <header className="flex items-center gap-2 px-2 py-2 border-b bg-card sticky top-0 z-20">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="flex-shrink-0 h-9 w-9">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="font-bold text-sm truncate leading-tight">
            <span className="text-foreground">{teamName}</span>
            <span className="text-muted-foreground mx-1.5 font-normal">vs</span>
            <span className="text-foreground">{opponentName}</span>
          </h1>
        </div>
        {!readOnly && (
          <Popover
            open={opponentEditOpen}
            onOpenChange={(o) => {
              setOpponentEditOpen(o);
              if (o) setDraftOpponent(opponentName);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 flex-shrink-0"
                aria-label="Edit opponent"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-2" align="end">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">Opponent name</label>
                <Input
                  value={draftOpponent}
                  onChange={(e) => setDraftOpponent(e.target.value)}
                  placeholder="Opponent"
                  maxLength={24}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      board.setOpponentName(draftOpponent.trim() || "Opponent");
                      setOpponentEditOpen(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    board.setOpponentName(draftOpponent.trim() || "Opponent");
                    setOpponentEditOpen(false);
                  }}
                >
                  Save
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        <SyncStatusIndicator />
      </header>

      {/* ── Hero timer ── */}
      <div className="border-b">
        <BasketballQuarterTimer
          state={board.timerState}
          onChange={board.setTimerState}
          onTick={board.handleTick}
          onQuarterEnd={board.handleQuarterEnd}
          onReset={board.resetPlayerStats}
          readOnly={readOnly}
        />
      </div>

      {/* ── Scoreboard ── */}
      <GameScoreboard
        homeLabel={teamName}
        awayLabel={opponentName}
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

      {/* Auto-sub status — only while game is in progress. */}
      {!readOnly && gameInProgress && board.rotationMode !== "off" && board.autoSubPlan.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-1 bg-primary/5">
          <span className="text-[10px] text-muted-foreground">
            Auto-subs: {board.autoSubPlan.filter((s) => s.executed).length}/{board.autoSubPlan.length}
            {board.autoSubPaused && <span className="ml-1.5 text-amber-600 font-medium">· Paused</span>}
            {board.lockedPlayerIds.size > 0 && (
              <span className="ml-1.5 text-amber-600">· {board.lockedPlayerIds.size} locked</span>
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1"
            onClick={() => setAutoSubPanelOpen(true)}
          >
            <Repeat className="h-3 w-3" />
            Subs Plan
          </Button>
        </div>
      )}

      {/* ── COURT — the dominant interaction zone ── */}
      <BasketballCourtArea
        players={board.players}
        selectedPlayerId={board.selectedPlayerId}
        nextSubOutId={board.nextSub?.playerOut.id ?? null}
        readOnly={readOnly}
        courtView={board.courtView}
        onPlayerClick={board.handlePlayerClick}
        onSlotClick={board.handleSlotClick}
      />

      {/* ── BENCH ── */}
      <BasketballBench
        bench={board.bench}
        selectedPlayerId={board.selectedPlayerId}
        nextSubInId={board.nextSub?.playerIn.id ?? null}
        readOnly={readOnly}
        onPlayerClick={board.handlePlayerClick}
      />

      {/* ── GAME DETAILS — collapsed by default. Houses linked event,
          timeouts, and coach insights so the live UI stays clean. ── */}
      <Collapsible open={gameDetailsOpen} onOpenChange={setGameDetailsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between w-full px-3 py-1.5 border-t bg-muted/10 text-[11px] font-medium text-muted-foreground/80 hover:bg-muted/30 transition-colors"
            aria-expanded={gameDetailsOpen}
          >
            <span>Game details</span>
            {gameDetailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <QuarterScoreStrip
            scoreLog={board.timerState.scoreLog}
            currentQuarter={board.timerState.currentQuarter}
            periodType={board.timerState.periodType ?? "quarters"}
          />
          <LinkedEventHeader
            eventId={linkedEventId || ""}
            teamId={teamId}
            teamName={teamName}
            compact
            onLinkEvent={readOnly ? undefined : setLinkedEventId}
            currentScore={{
              team: board.timerState.homeScore ?? 0,
              opponent: board.timerState.awayScore ?? 0,
            }}
            isGameInProgress={isLive}
          />
          <TimeoutsPanel
            homeLabel={teamName}
            awayLabel={opponentName}
            homeRemaining={
              board.timerState.homeTimeoutsRemaining ?? board.timerState.timeoutsPerHalf ?? 3
            }
            awayRemaining={
              board.timerState.awayTimeoutsRemaining ?? board.timerState.timeoutsPerHalf ?? 3
            }
            perHalf={board.timerState.timeoutsPerHalf ?? 3}
            half={board.timerState.currentQuarter <= 2 ? 1 : 2}
            readOnly={readOnly}
            onCall={board.callTimeout}
            onResetHalf={board.resetTimeoutsForCurrentHalf}
          />
          <BenchFairnessMeter players={board.players} elapsedSeconds={totalElapsed} />
          <MomentumStrip scoreLog={board.timerState.scoreLog} />
          <FoulFatigueWatchlist
            sport="basketball"
            players={board.players}
            currentQuarter={board.timerState.currentQuarter}
            totalElapsedSeconds={totalElapsed}
            minutesPerQuarter={board.timerState.minutesPerQuarter}
          />
          {!readOnly && (
            <SmartSubSuggestion
              players={board.players}
              totalElapsedSeconds={totalElapsed}
              isRunning={isLive}
              onApplySub={(outId, inId) => board.performSwap(outId, inId)}
            />
          )}
          {/* Audio cues toggle — moved out of the always-visible header to
              cut chrome. Sits with the other game-detail tools. */}
          <div className="flex items-center justify-between px-3 py-2 border-t">
            <span className="text-xs text-muted-foreground">Audio cues</span>
            <CuesToggle />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {!readOnly && (board.canUndoSub || (board.timerState.scoreLog?.length ?? 0) > 0) && (
        <div className="flex items-center justify-between gap-2 px-2 py-1 border-t bg-muted/10">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={board.undoLastSub}
            disabled={!board.canUndoSub}
          >
            <Undo2 className="h-3 w-3 mr-1" />
            Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setSummaryOpen(true)}
          >
            <Trophy className="h-3 w-3 mr-1" />
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
            readOnly={readOnly}
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
