import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import NetballQuarterTimer from "./NetballQuarterTimer";
import NetballActionBar from "./NetballActionBar";
import NetballCourtArea from "./NetballCourtArea";
import NetballBench from "./NetballBench";
import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import { useWakeLock } from "@/hooks/useWakeLock";

import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  NetballBoardState,
  NetballTimerState,
  Quarter,
  QuarterLineup,
  RotationMode,
  ValidationMode,
  NetballSubEvent,
  getNetballStateKey,
  getNetballTimerKey,
} from "./types";
import {
  getBench,
  getOnCourt,
  applyLineup,
  isPositionAllowedForPlayer,
  generateTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan,
  findNextDueSub,
  safeLoad,
  safeSave,
} from "./netballHelpers";
import { useNetballGameSync } from "@/hooks/useNetballGameSync";

// Lazy-load secondary dialogs
const NetballSettingsDialog = lazy(() => import("./NetballSettingsDialog"));
const QuarterLineupPlanner = lazy(() => import("./QuarterLineupPlanner"));
const NetballRosterDialog = lazy(() => import("./NetballRosterDialog"));
const NetballQuickActionSheet = lazy(() => import("./NetballQuickActionSheet"));

interface NetballBoardProps {
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
  /** When provided, board state is scoped to this event. */
  eventId?: string | null;
}

const DialogLoader = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-5 w-5 animate-spin text-primary" />
  </div>
);

export default function NetballBoard({
  teamId,
  teamName,
  members,
  onClose,
  readOnly = false,
  initialMinutesPerQuarter = 15,
  eventId = null,
}: NetballBoardProps) {
  const { toast } = useToast();
  const stateKey = getNetballStateKey(teamId, eventId);
  const timerKey = getNetballTimerKey(teamId, eventId);

  // ---------- Initial state ----------
  const savedStateRef = useRef<NetballBoardState | null>(null);
  const savedTimerRef = useRef<NetballTimerState | null>(null);
  const initLoadedRef = useRef(false);
  if (!initLoadedRef.current) {
    initLoadedRef.current = true;
    savedStateRef.current = safeLoad<NetballBoardState>(stateKey);
    savedTimerRef.current = safeLoad<NetballTimerState>(timerKey);
  }

  const buildInitialPlayers = (): NetballPlayer[] => {
    if (savedStateRef.current?.players?.length) return savedStateRef.current.players;
    return members
      .filter((m) => m.role === "player" || m.role === "parent" || m.role === "coach")
      .slice(0, 14)
      .map((m, idx) => ({
        id: m.id,
        name: m.profiles?.display_name?.trim() || `Player ${idx + 1}`,
        position: idx < 7 ? NETBALL_POSITIONS[idx] : null,
        minutesPlayed: 0,
        preferredPositions: [],
      }));
  };

  const [players, setPlayers] = useState<NetballPlayer[]>(buildInitialPlayers);
  const [rotationMode, setRotationMode] = useState<RotationMode>(
    savedStateRef.current?.rotationMode ?? "off"
  );
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(
    savedStateRef.current?.rotationIntervalMinutes ?? 5
  );
  const [validationMode, setValidationMode] = useState<ValidationMode>(
    savedStateRef.current?.validationMode ?? "warn"
  );
  const [autoSubPlan, setAutoSubPlan] = useState<NetballSubEvent[]>(
    savedStateRef.current?.autoSubPlan ?? []
  );
  const [quarterLineups, setQuarterLineups] = useState<QuarterLineup[]>(
    savedStateRef.current?.quarterLineups ?? []
  );

  const [timerState, setTimerState] = useState<NetballTimerState>(() => {
    return (
      savedTimerRef.current ?? {
        minutesPerQuarter: initialMinutesPerQuarter,
        currentQuarter: 1,
        elapsedSeconds: 0,
        isRunning: false,
        lastUpdateTime: Date.now(),
      }
    );
  });

  // UI state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineupPlannerOpen, setLineupPlannerOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [quickActionPlayerId, setQuickActionPlayerId] = useState<string | null>(null);

  // ---------- Aggregated state for persistence + sync ----------
  const boardState: NetballBoardState = useMemo(
    () => ({
      teamId,
      players,
      currentQuarter: timerState.currentQuarter,
      rotationMode,
      rotationIntervalMinutes,
      validationMode,
      autoSubPlan,
      autoSubActive: rotationMode !== "off",
      autoSubPaused: false,
      quarterLineups,
      lastUpdateTime: Date.now(),
    }),
    [
      teamId,
      players,
      timerState.currentQuarter,
      rotationMode,
      rotationIntervalMinutes,
      validationMode,
      autoSubPlan,
      quarterLineups,
    ]
  );

  // ---------- Persistence (local) ----------
  useEffect(() => {
    safeSave(stateKey, boardState);
  }, [boardState, stateKey]);

  useEffect(() => {
    safeSave(timerKey, timerState);
  }, [timerState, timerKey]);

  // ---------- Persistence (Supabase) — only when actively editing ----------
  useNetballGameSync(boardState, timerState, !readOnly);

  // ---------- Time tracking ----------
  // `delta` is the real elapsed seconds since the last tick. Using a constant
  // `1` here causes drift when the app backgrounds (the timer catches up via
  // wall-clock but per-player minutes wouldn't).
  const handleTick = useCallback(
    (elapsed: number, quarter: Quarter, delta = 1) => {
      const safeDelta = Math.max(1, Math.floor(delta));
      setPlayers((prev) =>
        prev.map((p) =>
          p.position !== null
            ? { ...p, minutesPlayed: (p.minutesPlayed ?? 0) + safeDelta }
            : p
        )
      );

      if (rotationMode !== "off") {
        const due = findNextDueSub(autoSubPlan, quarter, elapsed);
        if (due) executeSub(due);
      }
    },
    [autoSubPlan, rotationMode] // executeSub stable via setState callbacks
  );

  // ---------- Sub execution ----------
  const executeSub = useCallback(
    (sub: NetballSubEvent) => {
      setPlayers((prev) => {
        const out = prev.find((p) => p.id === sub.playerOut.id);
        const inP = prev.find((p) => p.id === sub.playerIn.id);
        if (!out?.position || !inP || inP.position !== null) return prev;
        return prev.map((p) => {
          if (p.id === out.id) return { ...p, position: null };
          if (p.id === inP.id) return { ...p, position: sub.position };
          return p;
        });
      });
      setAutoSubPlan((prev) => prev.map((s) => (s === sub ? { ...s, executed: true } : s)));
      toast({
        title: "Auto-sub",
        description: `${sub.playerIn.name} ON for ${sub.playerOut.name} at ${sub.position}`,
      });
    },
    [toast]
  );

  // ---------- Quarter end → quarter-break rotations + apply next lineup ----------
  const handleQuarterEnd = useCallback(
    (endedQuarter: Quarter) => {
      const nextQuarter = (endedQuarter + 1) as Quarter;
      if (nextQuarter > 4) {
        toast({ title: "Game finished", description: "Q4 complete." });
        return;
      }
      const nextLineup = quarterLineups.find((l) => l.quarter === nextQuarter);
      if (nextLineup && Object.keys(nextLineup.assignments).length > 0) {
        setPlayers((prev) => applyLineup(prev, nextLineup));
        toast({
          title: `Q${nextQuarter} lineup applied`,
          description: "On-court 7 updated from your plan.",
        });
        return;
      }
      if (rotationMode === "quarter-break") {
        const dueSubs = autoSubPlan.filter(
          (s) => !s.executed && s.quarter === nextQuarter && s.time === 0
        );
        dueSubs.forEach(executeSub);
      }
    },
    [autoSubPlan, executeSub, quarterLineups, rotationMode, toast]
  );

  // ---------- Manual swap / sub interactions ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      setPlayers((prev) => {
        const a = prev.find((p) => p.id === aId);
        const b = prev.find((p) => p.id === bId);
        if (!a || !b) return prev;

        const enforce = (who: NetballPlayer, pos: NetballPosition | null): boolean => {
          if (!pos) return true;
          if (validationMode === "free") return true;
          const ok = isPositionAllowedForPlayer(who, pos);
          if (!ok && validationMode === "warn") {
            toast({
              title: "Position warning",
              description: `${who.name} isn't a preferred ${pos}.`,
            });
            return true;
          }
          if (!ok && validationMode === "strict") {
            toast({
              title: "Move blocked",
              description: `${who.name} can't play ${pos} in strict mode.`,
              variant: "destructive",
            });
            return false;
          }
          return true;
        };

        if (!enforce(a, b.position) || !enforce(b, a.position)) return prev;

        return prev.map((p) => {
          if (p.id === a.id) return { ...p, position: b.position };
          if (p.id === b.id) return { ...p, position: a.position };
          return p;
        });
      });
    },
    [validationMode, toast]
  );

  const handlePlayerClick = useCallback(
    (playerId: string) => {
      if (readOnly) return;
      // Swap-mode active → second tap completes the swap.
      if (selectedPlayerId) {
        if (selectedPlayerId === playerId) {
          setSelectedPlayerId(null);
          return;
        }
        performSwap(selectedPlayerId, playerId);
        setSelectedPlayerId(null);
        return;
      }
      setQuickActionPlayerId(playerId);
    },
    [selectedPlayerId, performSwap, readOnly]
  );

  const handleSlotClick = useCallback(
    (position: NetballPosition) => {
      if (readOnly || !selectedPlayerId) return;
      setPlayers((prev) =>
        prev.map((p) => (p.id === selectedPlayerId ? { ...p, position } : p))
      );
      setSelectedPlayerId(null);
    },
    [readOnly, selectedPlayerId]
  );

  const subOff = useCallback((playerId: string) => {
    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, position: null } : p)));
  }, []);

  const toggleInjured = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
  }, []);

  // ---------- Scoring ----------
  const addScore = useCallback((side: "home" | "away", points: number) => {
    setTimerState((s) => {
      const event = {
        id: crypto.randomUUID(),
        side,
        points,
        quarter: s.currentQuarter,
        at: Date.now(),
      };
      return {
        ...s,
        homeScore: (s.homeScore ?? 0) + (side === "home" ? points : 0),
        awayScore: (s.awayScore ?? 0) + (side === "away" ? points : 0),
        scoreLog: [...(s.scoreLog ?? []), event],
        lastUpdateTime: Date.now(),
      };
    });
  }, []);

  const undoScore = useCallback(() => {
    setTimerState((s) => {
      const log = s.scoreLog ?? [];
      if (log.length === 0) return s;
      const last = log[log.length - 1];
      return {
        ...s,
        homeScore: Math.max(0, (s.homeScore ?? 0) - (last.side === "home" ? last.points : 0)),
        awayScore: Math.max(0, (s.awayScore ?? 0) - (last.side === "away" ? last.points : 0)),
        scoreLog: log.slice(0, -1),
        lastUpdateTime: Date.now(),
      };
    });
  }, []);

  const setOpponentName = useCallback((name: string) => {
    setTimerState((s) => ({ ...s, opponentName: name, lastUpdateTime: Date.now() }));
  }, []);

  // ---------- Generate auto-sub plan when settings or roster change ----------
  // A roster signature ensures manual swaps & roster edits regenerate the plan
  // — without it, a stale closure used the original on-court 7 forever.
  const rosterSignature = useMemo(
    () =>
      players
        .map((p) => `${p.id}:${p.position ?? "bench"}:${p.isInjured ? "x" : "o"}`)
        .sort()
        .join("|"),
    [players]
  );

  useEffect(() => {
    if (rotationMode === "off") {
      setAutoSubPlan([]);
      return;
    }
    if (rotationMode === "time-based") {
      setAutoSubPlan(
        generateTimeBasedRotationPlan(players, rotationIntervalMinutes, timerState.minutesPerQuarter)
      );
    } else if (rotationMode === "quarter-break") {
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter, rosterSignature]);

  // ---------- Derived ----------
  const bench = useMemo(() => getBench(players), [players]);
  const nextSub = useMemo(
    () => findNextDueSub(autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds + 30),
    [autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds]
  );

  const quickActionPlayer = useMemo(
    () => players.find((p) => p.id === quickActionPlayerId) ?? null,
    [players, quickActionPlayerId]
  );

  const applyNextLineupNow = () => {
    const nextQ = timerState.currentQuarter;
    const lineup = quarterLineups.find((l) => l.quarter === nextQ);
    if (!lineup || Object.keys(lineup.assignments).length === 0) {
      toast({
        title: "No lineup planned",
        description: `Open the Lineup Planner to set up Q${nextQ}.`,
        variant: "destructive",
      });
      return;
    }
    setPlayers((prev) => applyLineup(prev, lineup));
    toast({ title: `Q${nextQ} lineup applied` });
  };

  // Keep the screen awake while a coach is actively running the game.
  useWakeLock(!readOnly && timerState.isRunning && !timerState.isGameFinished);

  // ---------- Render ----------
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 p-2 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm truncate">{teamName}</h1>
          <p className="text-[10px] text-muted-foreground">Netball Game Board</p>
        </div>
        <NetballQuarterTimer
          state={timerState}
          onChange={setTimerState}
          onTick={handleTick}
          onQuarterEnd={handleQuarterEnd}
          readOnly={readOnly}
        />
      </header>

      <GameScoreboard
        homeLabel={teamName}
        awayLabel={timerState.opponentName ?? "Opponent"}
        homeScore={timerState.homeScore ?? 0}
        awayScore={timerState.awayScore ?? 0}
        increments={[1]}
        readOnly={readOnly}
        disabled={!!timerState.isGameFinished}
        onScore={addScore}
        onUndo={undoScore}
        onRenameAway={setOpponentName}
        canUndo={(timerState.scoreLog?.length ?? 0) > 0}
      />

      <QuarterScoreStrip
        scoreLog={timerState.scoreLog}
        currentQuarter={timerState.currentQuarter}
      />

      {!readOnly && (
        <NetballActionBar
          onOpenSquad={() => setRosterOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onApplyLineup={applyNextLineupNow}
          currentQuarter={timerState.currentQuarter}
          rotationMode={rotationMode}
          rotationIntervalMinutes={rotationIntervalMinutes}
        />
      )}

      <NetballCourtArea
        players={players}
        selectedPlayerId={selectedPlayerId}
        nextSubOutId={nextSub?.playerOut.id ?? null}
        readOnly={readOnly}
        onPlayerClick={handlePlayerClick}
        onSlotClick={handleSlotClick}
      />

      <NetballBench
        bench={bench}
        selectedPlayerId={selectedPlayerId}
        nextSubInId={nextSub?.playerIn.id ?? null}
        readOnly={readOnly}
        onPlayerClick={handlePlayerClick}
      />

      {validationMode !== "free" && (
        <div className="px-3 py-1 bg-muted/40 border-t flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground">
            {validationMode === "strict"
              ? "Strict mode: invalid moves are blocked."
              : "Warn mode: invalid moves trigger a warning."}
          </p>
        </div>
      )}

      <Suspense fallback={<DialogLoader />}>
        {settingsOpen && (
          <NetballSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            minutesPerQuarter={timerState.minutesPerQuarter}
            onMinutesPerQuarterChange={(n) =>
              setTimerState((s) => ({ ...s, minutesPerQuarter: n, lastUpdateTime: Date.now() }))
            }
            rotationMode={rotationMode}
            onRotationModeChange={setRotationMode}
            rotationIntervalMinutes={rotationIntervalMinutes}
            onRotationIntervalChange={setRotationIntervalMinutes}
            validationMode={validationMode}
            onValidationModeChange={setValidationMode}
          />
        )}
        {lineupPlannerOpen && (
          <QuarterLineupPlanner
            open={lineupPlannerOpen}
            onOpenChange={setLineupPlannerOpen}
            players={players}
            lineups={quarterLineups}
            onSave={setQuarterLineups}
          />
        )}
        {rosterOpen && (
          <NetballRosterDialog
            open={rosterOpen}
            onOpenChange={setRosterOpen}
            players={players}
            onSave={setPlayers}
          />
        )}
        {quickActionPlayerId && quickActionPlayer && (
          <NetballQuickActionSheet
            open={!!quickActionPlayerId}
            onOpenChange={(o) => !o && setQuickActionPlayerId(null)}
            player={quickActionPlayer}
            onStartSwap={() => setSelectedPlayerId(quickActionPlayer.id)}
            onSubOff={() => subOff(quickActionPlayer.id)}
            onSubOn={() => setSelectedPlayerId(quickActionPlayer.id)}
            onToggleInjured={() => toggleInjured(quickActionPlayer.id)}
          />
        )}
      </Suspense>
    </div>
  );
}
