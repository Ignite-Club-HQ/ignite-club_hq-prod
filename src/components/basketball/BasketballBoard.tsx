import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Repeat, Trophy, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SyncStatusIndicator } from "@/components/pitch/SyncStatusIndicator";

import BasketballQuarterTimer from "./BasketballQuarterTimer";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";
import BasketballQuarterBreakDialog from "./BasketballQuarterBreakDialog";
import BasketballPreGameScreen from "./BasketballPreGameScreen";
import LiveGameHUD from "./LiveGameHUD";
import SubModeBanner from "./SubModeBanner";
import { useBasketballBoardState } from "@/hooks/useBasketballBoardState";
import { useBasketballCoachAssistant } from "@/hooks/useBasketballCoachAssistant";
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
  // HUD dock position (top/bottom of court) — persists across sessions.
  const [hudPosition, setHudPosition] = useState<"top" | "bottom">(() => {
    if (typeof window === "undefined") return "top";
    const saved = window.localStorage.getItem("basketball:hudPosition");
    return saved === "bottom" ? "bottom" : "top";
  });
  const toggleHudPosition = () => {
    setHudPosition((prev) => {
      const next = prev === "top" ? "bottom" : "top";
      try {
        window.localStorage.setItem("basketball:hudPosition", next);
      } catch {
        /* ignore storage errors (private mode, quota, etc.) */
      }
      return next;
    });
  };
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

  // Background coach assistant — silently observes playing time and surfaces
  // subtle hints (over-played outline, under-played glow, "Sub due" badge) +
  // fires a throttled toast/cue when fairness drifts. NEVER mutates state.
  const assistant = useBasketballCoachAssistant({
    players: board.players,
    isRunning: !!board.timerState.isRunning,
    isGameFinished: !!board.timerState.isGameFinished,
    paused: board.autoSubPaused,
    totalElapsedSeconds: totalElapsed,
    readOnly,
  });

  const isLive = !!board.timerState.isRunning && !board.timerState.isGameFinished;
  const onCourtCount = board.players.filter((p) => p.position !== null).length;
  const lineupSet = onCourtCount >= 5;
  const opponentName = board.timerState.opponentName ?? "Opponent";
  // Pre-game = before the first whistle AND no scores logged yet.
  // Game-in-progress = anything after first tip-off (running OR paused for a
  // timeout) until finished. We use this — not isLive — to hide setup UI so
  // pausing the clock doesn't suddenly leak "Set starting 5" back on screen.
  const hasGameStarted =
    board.timerState.isRunning ||
    board.timerState.currentQuarter > 1 ||
    board.timerState.elapsedSeconds > 0 ||
    (board.timerState.scoreLog?.length ?? 0) > 0 ||
    board.timerState.isGameFinished;
  const isPreGame = !hasGameStarted;
  const gameInProgress = hasGameStarted && !board.timerState.isGameFinished;

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
          onAssign={board.assignToPosition}
          minutesPerQuarter={board.timerState.minutesPerQuarter}
          periodType={board.timerState.periodType ?? "quarters"}
          rotationMode={board.rotationMode}
          rotationIntervalMinutes={board.rotationIntervalMinutes}
          onToggleAutoSub={(next) => {
            board.setRotationMode(next);
            persistDefaults({ court_rotation_mode: next });
          }}
          onRotationIntervalChange={(n) => {
            board.setRotationIntervalMinutes(n);
            persistDefaults({ court_rotation_interval_minutes: n });
          }}
          onPreviewPlan={() => setAutoSubPanelOpen(true)}
          hasAutoSubPlan={board.autoSubPlan.some((s) => !s.executed && !s.skipped)}
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
          {autoSubPanelOpen && (
            <QuarterAutoSubControlPanel
              open={autoSubPanelOpen}
              onClose={() => setAutoSubPanelOpen(false)}
              autoSubPlan={board.autoSubPlan}
              onPlayers={board.players.map((p) => ({
                id: p.id,
                name: p.name,
                position: p.position,
                secondsPlayed: p.minutesPlayed ?? 0,
              })) as any}
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
              previewMode
            />
          )}
        </Suspense>
      </>
    );
  }

  // ── LIVE / FINISHED ──────────────────────────────────────────────
  // Strict live mode: no setup UI, no edit affordances, no collapsible
  // "Game details". Three zones only:
  //   TOP    — scoreboard (dominant scores) + timer strip (secondary)
  //   MIDDLE — court (who is playing)
  //   BOTTOM — bench (who comes on next)
  // Selected player + bench/court partition for the new sub-flow visuals.
  const selectedPlayer = board.selectedPlayerId
    ? board.players.find((p) => p.id === board.selectedPlayerId) ?? null
    : null;
  const selectedIsOnCourt = !!selectedPlayer && selectedPlayer.position !== null;
  const selectedIsOnBench = !!selectedPlayer && selectedPlayer.position === null;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── COURT — full-bleed primary surface with floating HUD overlay ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Tap-outside-to-cancel — invisible scrim that swallows taps in the
            empty court area while a player is selected. Sits below tokens
            and the banner but above the court SVG. */}
        {selectedPlayer && (
          <button
            type="button"
            aria-label="Cancel substitution"
            onClick={() => board.setSelectedPlayerId(null)}
            className="absolute inset-0 z-10 cursor-default bg-transparent"
          />
        )}

        {/* Sub-mode banner — replaces the back chip + HUD scoreboard while a
            sub is in progress so the coach has zero ambiguity. */}
        {selectedPlayer ? (
          <SubModeBanner
            selectedPlayer={selectedPlayer}
            onCancel={() => board.setSelectedPlayerId(null)}
          />
        ) : (
          <>
            {/* Floating back chip — always on the left */}
            <Button
              variant="secondary"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              className="absolute z-40 top-2 left-2 h-8 w-8 rounded-full bg-card/85 backdrop-blur-md border border-border/40 shadow-md"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            {/* Floating HUD — scoreboard + timer over the court */}
            <LiveGameHUD
              homeLabel={teamName}
              awayLabel={opponentName}
              homeScore={board.timerState.homeScore ?? 0}
              awayScore={board.timerState.awayScore ?? 0}
              increments={[1, 2, 3]}
              readOnly={readOnly}
              disabled={!!board.timerState.isGameFinished}
              onScore={board.addScore}
              suppressed={!!board.selectedPlayerId}
              controlSlot={
                <BasketballQuarterTimer
                  state={board.timerState}
                  onChange={board.setTimerState}
                  onTick={board.handleTick}
                  onQuarterEnd={board.handleQuarterEnd}
                  onReset={board.resetPlayerStats}
                  readOnly={readOnly}
                  compact
                  onOpenAutoSubPlan={
                    !readOnly && board.rotationMode !== "off"
                      ? () => setAutoSubPanelOpen(true)
                      : undefined
                  }
                  hasAutoSubPlan={board.autoSubPlan.length > 0}
                />
              }
              position={hudPosition}
              onTogglePosition={toggleHudPosition}
            />

            {/* Auto-sub status — prominent chip docked at bottom-left of court, always visible when rotation is on */}
            {!readOnly && gameInProgress && board.rotationMode !== "off" && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <Button
                  size="sm"
                  variant={board.autoSubPaused ? "outline" : "default"}
                  className="h-10 text-sm font-semibold gap-2 px-4 shadow-xl rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => setAutoSubPanelOpen(true)}
                >
                  <Repeat className="h-3.5 w-3.5" />
                  {board.autoSubPlan.length === 0 ? (
                    <span>Auto-subs</span>
                  ) : board.autoSubPaused ? (
                    <span>Paused</span>
                  ) : board.nextSub ? (
                    <>
                      <span className="opacity-80">Next sub</span>
                      <span className="font-mono tabular-nums">
                        {(() => {
                          const remaining = Math.max(
                            0,
                            board.nextSub.time - board.timerState.elapsedSeconds
                          );
                          const m = Math.floor(remaining / 60);
                          const s = remaining % 60;
                          return `${m}:${s.toString().padStart(2, "0")}`;
                        })()}
                      </span>
                    </>
                  ) : (
                    <span>
                      Subs {board.autoSubPlan.filter((s) => s.executed).length}/
                      {board.autoSubPlan.length}
                    </span>
                  )}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Court fills the surface — HUD floats above */}
        <BasketballCourtArea
          players={board.players}
          selectedPlayerId={board.selectedPlayerId}
          selectedIsOnBench={selectedIsOnBench}
          recentlySwappedIds={board.recentlySwappedIds}
          nextSubOutId={board.nextSub?.playerOut.id ?? null}
          overplayedOnCourtId={
            // Plan-driven sub takes priority; fall back to the assistant hint.
            board.nextSub?.playerOut.id ?? assistant.overplayedOnCourtId
          }
          readOnly={readOnly}
          courtView={board.courtView}
          hideEmptySlots
          onPlayerClick={board.handlePlayerClick}
          onPlayerLongPress={board.handlePlayerLongPress}
          onSlotClick={board.handleSlotClick}
        />
      </div>

      {/* ── BENCH — tap to sub. Lowest-minutes player is highlighted as "next up". ── */}
      <BasketballBench
        bench={board.bench}
        selectedPlayerId={board.selectedPlayerId}
        selectedIsOnCourt={selectedIsOnCourt}
        recentlySwappedIds={board.recentlySwappedIds}
        nextSubInId={board.nextSub?.playerIn.id ?? null}
        underplayedBenchIds={
          board.nextSub ? [] : assistant.underplayedBenchIds
        }
        showSubDueBadge={!board.nextSub && assistant.hasActiveSuggestion}
        readOnly={readOnly}
        onPlayerClick={board.handlePlayerClick}
        onPlayerLongPress={board.handlePlayerLongPress}
      />

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
            onPlayers={board.players.map((p) => ({
              id: p.id,
              name: p.name,
              position: p.position,
              secondsPlayed: p.minutesPlayed ?? 0,
            })) as any}
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
