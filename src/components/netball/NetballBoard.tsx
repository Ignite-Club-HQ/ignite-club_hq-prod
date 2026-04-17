import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Loader2, Trophy, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import NetballQuarterTimer from "./NetballQuarterTimer";
import NetballActionBar from "./NetballActionBar";
import NetballCourtArea from "./NetballCourtArea";
import NetballBench from "./NetballBench";
import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import CentrePassIndicator from "@/components/scoreboard/CentrePassIndicator";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import CuesToggle from "@/components/scoreboard/CuesToggle";
import { useWakeLock } from "@/hooks/useWakeLock";
import { cueQuarterEnd, cueSubDue } from "@/lib/gameCues";

import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  NetballBoardState,
  NetballTimerState,
  NetballSubLogEntry,
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
  transitionPosition,
} from "./netballHelpers";
import { useNetballGameSync } from "@/hooks/useNetballGameSync";

// Lazy-load secondary dialogs
const NetballSettingsDialog = lazy(() => import("./NetballSettingsDialog"));
const QuarterLineupPlanner = lazy(() => import("./QuarterLineupPlanner"));
const NetballRosterDialog = lazy(() => import("./NetballRosterDialog"));
const NetballQuickActionSheet = lazy(() => import("./NetballQuickActionSheet"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));

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
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Auto-open the summary the first time the game ticks over to "finished".
  useEffect(() => {
    if (timerState.isGameFinished) setSummaryOpen(true);
  }, [timerState.isGameFinished]);

  // ---------- Sub log writer (single funnel for auto + manual subs) ----------
  const appendSubLog = useCallback(
    (entry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time">) => {
      setTimerState((s) => ({
        ...s,
        subLog: [
          ...(s.subLog ?? []),
          {
            ...entry,
            id: crypto.randomUUID(),
            at: Date.now(),
            quarter: s.currentQuarter,
            time: s.elapsedSeconds,
          },
        ],
        lastUpdateTime: Date.now(),
      }));
    },
    []
  );

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
  // Track sub-cue de-dupe so we don't beep every second.
  const cuedSubIdsRef = useRef<Set<string>>(new Set());
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
        const upcoming = findNextDueSub(autoSubPlan, quarter, elapsed + 10);
        if (upcoming && upcoming.time > elapsed) {
          const key = `${quarter}:${upcoming.time}:${upcoming.playerOut.id}`;
          if (!cuedSubIdsRef.current.has(key)) {
            cuedSubIdsRef.current.add(key);
            cueSubDue();
          }
        }
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
          if (p.id === out.id) return transitionPosition(p, null);
          if (p.id === inP.id) return transitionPosition(p, sub.position);
          return p;
        });
      });
      setAutoSubPlan((prev) => prev.map((s) => (s === sub ? { ...s, executed: true } : s)));
      appendSubLog({
        playerOutId: sub.playerOut.id,
        playerOutName: sub.playerOut.name,
        playerInId: sub.playerIn.id,
        playerInName: sub.playerIn.name,
        position: sub.position,
        source: "auto",
      });
      toast({
        title: "Auto-sub",
        description: `${sub.playerIn.name} ON for ${sub.playerOut.name} at ${sub.position}`,
      });
    },
    [toast, appendSubLog]
  );

  // ---------- Quarter end → quarter-break rotations + apply next lineup ----------
  const handleQuarterEnd = useCallback(
    (endedQuarter: Quarter) => {
      cueQuarterEnd();
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
      // Position lock: in strict/warn mode, validate against preferredPositions
      const incoming = players.find((p) => p.id === selectedPlayerId);
      if (incoming && validationMode !== "free") {
        const ok = isPositionAllowedForPlayer(incoming, position);
        if (!ok) {
          if (validationMode === "strict") {
            toast({
              title: "Move blocked",
              description: `${incoming.name} can't play ${position} in strict mode.`,
              variant: "destructive",
            });
            setSelectedPlayerId(null);
            return;
          }
          toast({
            title: "Position warning",
            description: `${incoming.name} isn't a preferred ${position}.`,
          });
        }
      }
      let logEntry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time"> | null = null;
      setPlayers((prev) => {
        const incoming = prev.find((p) => p.id === selectedPlayerId);
        if (!incoming) return prev;
        const displaced = prev.find((p) => p.position === position && p.id !== incoming.id);
        if (incoming.position === null) {
          logEntry = {
            playerOutId: displaced?.id ?? "",
            playerOutName: displaced?.name ?? "(empty)",
            playerInId: incoming.id,
            playerInName: incoming.name,
            position,
            source: "manual",
          };
        }
        return prev.map((p) => (p.id === selectedPlayerId ? { ...p, position } : p));
      });
      if (logEntry) appendSubLog(logEntry);
      setSelectedPlayerId(null);
    },
    [readOnly, selectedPlayerId, appendSubLog, players, validationMode, toast]
  );

  const subOff = useCallback(
    (playerId: string) => {
      let outName: string | null = null;
      let outPos: NetballPosition | null = null;
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === playerId && p.position) {
            outName = p.name;
            outPos = p.position;
            return transitionPosition(p, null);
          }
          return p;
        })
      );
      if (outName && outPos) {
        appendSubLog({
          playerOutId: playerId,
          playerOutName: outName,
          playerInId: "",
          playerInName: "(bench)",
          position: outPos,
          source: "manual",
        });
      }
    },
    [appendSubLog]
  );

  const toggleInjured = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
  }, []);

  // ---------- Undo last sub ----------
  const undoLastSub = useCallback(() => {
    const log = timerState.subLog ?? [];
    if (log.length === 0) {
      toast({ title: "Nothing to undo", description: "No subs recorded yet." });
      return;
    }
    const last = log[log.length - 1];
    setPlayers((prev) =>
      prev.map((p) => {
        if (last.playerInId === "" && p.id === last.playerOutId) {
          const slotTaken = prev.some((x) => x.id !== p.id && x.position === last.position);
          if (slotTaken) return p;
          return transitionPosition(p, last.position);
        }
        if (p.id === last.playerInId) return transitionPosition(p, null);
        if (p.id === last.playerOutId) return transitionPosition(p, last.position);
        return p;
      })
    );
    setTimerState((s) => ({
      ...s,
      subLog: (s.subLog ?? []).slice(0, -1),
      lastUpdateTime: Date.now(),
    }));
    toast({
      title: "Sub undone",
      description: last.playerInId
        ? `${last.playerOutName} back ON for ${last.playerInName}`
        : `${last.playerOutName} back ON`,
    });
  }, [timerState.subLog, toast]);

  const setMvp = useCallback((playerId: string | null) => {
    setTimerState((s) => ({ ...s, mvpPlayerId: playerId, lastUpdateTime: Date.now() }));
  }, []);

  // ---------- Scoring ----------
  // After every goal, the centre pass automatically flips to the OTHER side.
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
        centrePass: side === "home" ? "away" : "home",
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
        // Flip centre pass back to the team that just had it taken away.
        centrePass: last.side,
        lastUpdateTime: Date.now(),
      };
    });
  }, []);

  const setCentrePass = useCallback((side: "home" | "away") => {
    setTimerState((s) => ({ ...s, centrePass: side, lastUpdateTime: Date.now() }));
  }, []);

  const setOpponentName = useCallback((name: string) => {
    setTimerState((s) => ({ ...s, opponentName: name, lastUpdateTime: Date.now() }));
  }, []);

  // ---------- Period type (quarters vs halves) ----------
  const setPeriodType = useCallback((next: "quarters" | "halves") => {
    setTimerState((s) => {
      const prev = s.periodType ?? "quarters";
      if (prev === next) return s;
      const baseline =
        prev === "halves" ? Math.max(5, Math.round(s.minutesPerQuarter / 2)) : s.minutesPerQuarter;
      const newMinutes = next === "halves" ? baseline * 2 : baseline;
      return {
        ...s,
        periodType: next,
        minutesPerQuarter: newMinutes,
        lastUpdateTime: Date.now(),
      };
    });
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

  // Sport-agnostic player rows for the summary dialog.
  const summaryPlayers = useMemo(
    () =>
      players.map((p) => ({
        id: p.id,
        name: p.name,
        secondsPlayed: p.minutesPlayed ?? 0,
        isInjured: !!p.isInjured,
        finalPosition: p.position ?? null,
      })),
    [players]
  );

  const perQuarter = useMemo(() => {
    const log = timerState.scoreLog ?? [];
    return [1, 2, 3, 4].map((q) => ({
      quarter: q,
      home: log
        .filter((e) => e.quarter === q && e.side === "home")
        .reduce((sum, e) => sum + e.points, 0),
      away: log
        .filter((e) => e.quarter === q && e.side === "away")
        .reduce((sum, e) => sum + e.points, 0),
    }));
  }, [timerState.scoreLog]);

  const canUndoSub = (timerState.subLog?.length ?? 0) > 0;

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
        <CuesToggle />
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

      <CentrePassIndicator
        homeLabel={teamName}
        awayLabel={timerState.opponentName ?? "Opponent"}
        side={timerState.centrePass ?? "home"}
        readOnly={readOnly}
        onSwap={() =>
          setCentrePass((timerState.centrePass ?? "home") === "home" ? "away" : "home")
        }
      />

      <BenchFairnessMeter
        players={players}
        elapsedSeconds={
          timerState.elapsedSeconds +
          (timerState.currentQuarter - 1) * timerState.minutesPerQuarter * 60
        }
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

      {!readOnly && (canUndoSub || (timerState.scoreLog?.length ?? 0) > 0) && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={undoLastSub}
            disabled={!canUndoSub}
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
        {summaryOpen && (
          <GameSummaryDialog
            open={summaryOpen}
            onOpenChange={setSummaryOpen}
            sport="netball"
            homeLabel={teamName}
            awayLabel={timerState.opponentName ?? "Opponent"}
            homeScore={timerState.homeScore ?? 0}
            awayScore={timerState.awayScore ?? 0}
            perQuarter={perQuarter}
            players={summaryPlayers}
            mvpPlayerId={timerState.mvpPlayerId ?? null}
            onSelectMvp={setMvp}
            readOnly={readOnly}
          />
        )}
      </Suspense>
    </div>
  );
}
