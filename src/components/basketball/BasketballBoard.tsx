import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import BasketballQuarterTimer from "./BasketballQuarterTimer";
import BasketballActionBar from "./BasketballActionBar";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";

import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  BasketballBoardState,
  BasketballTimerState,
  Quarter,
  QuarterLineup,
  RotationMode,
  ValidationMode,
  BasketballSubEvent,
  getBasketballStateKey,
  getBasketballTimerKey,
} from "./types";
import {
  getBench,
  applyLineup,
  generateTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan,
  findNextDueSub,
  safeLoad,
  safeSave,
} from "./basketballHelpers";
import { useBasketballGameSync } from "@/hooks/useBasketballGameSync";

// Lazy-load secondary dialogs
const BasketballSettingsDialog = lazy(() => import("./BasketballSettingsDialog"));
const BasketballQuarterLineupPlanner = lazy(() => import("./BasketballQuarterLineupPlanner"));
const BasketballRosterDialog = lazy(() => import("./BasketballRosterDialog"));
const BasketballQuickActionSheet = lazy(() => import("./BasketballQuickActionSheet"));

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
}: BasketballBoardProps) {
  const { toast } = useToast();
  const stateKey = getBasketballStateKey(teamId);
  const timerKey = getBasketballTimerKey(teamId);

  // ---------- Initial state ----------
  const savedStateRef = useRef<BasketballBoardState | null>(null);
  const savedTimerRef = useRef<BasketballTimerState | null>(null);
  const initLoadedRef = useRef(false);
  if (!initLoadedRef.current) {
    initLoadedRef.current = true;
    savedStateRef.current = safeLoad<BasketballBoardState>(stateKey);
    savedTimerRef.current = safeLoad<BasketballTimerState>(timerKey);
  }

  const buildInitialPlayers = (): BasketballPlayer[] => {
    if (savedStateRef.current?.players?.length) return savedStateRef.current.players;
    return members
      .filter((m) => m.role === "player" || m.role === "parent" || m.role === "coach")
      .slice(0, 12)
      .map((m, idx) => ({
        id: m.id,
        name: m.profiles?.display_name?.trim() || `Player ${idx + 1}`,
        position: idx < 5 ? BASKETBALL_POSITIONS[idx] : null,
        minutesPlayed: 0,
        fouls: 0,
        preferredPositions: [],
      }));
  };

  const [players, setPlayers] = useState<BasketballPlayer[]>(buildInitialPlayers);
  const [rotationMode, setRotationMode] = useState<RotationMode>(
    savedStateRef.current?.rotationMode ?? "off"
  );
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(
    savedStateRef.current?.rotationIntervalMinutes ?? 4
  );
  const [validationMode, setValidationMode] = useState<ValidationMode>(
    savedStateRef.current?.validationMode ?? "free"
  );
  const [autoSubPlan, setAutoSubPlan] = useState<BasketballSubEvent[]>(
    savedStateRef.current?.autoSubPlan ?? []
  );
  const [quarterLineups, setQuarterLineups] = useState<QuarterLineup[]>(
    savedStateRef.current?.quarterLineups ?? []
  );

  const [timerState, setTimerState] = useState<BasketballTimerState>(() => {
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

  // ---------- Aggregated state ----------
  const boardState: BasketballBoardState = useMemo(
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

  // ---------- Persistence ----------
  useEffect(() => { safeSave(stateKey, boardState); }, [boardState, stateKey]);
  useEffect(() => { safeSave(timerKey, timerState); }, [timerState, timerKey]);
  useBasketballGameSync(boardState, timerState, !readOnly);

  // ---------- Sub execution ----------
  const executeSub = useCallback(
    (sub: BasketballSubEvent) => {
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

  // ---------- Time tracking ----------
  const handleTick = useCallback(
    (elapsed: number, quarter: Quarter) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.position !== null ? { ...p, minutesPlayed: (p.minutesPlayed ?? 0) + 1 } : p
        )
      );
      if (rotationMode !== "off") {
        const due = findNextDueSub(autoSubPlan, quarter, elapsed);
        if (due) executeSub(due);
      }
    },
    [autoSubPlan, rotationMode, executeSub]
  );

  // ---------- Quarter end ----------
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
          description: "On-court 5 updated from your plan.",
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

  // ---------- Manual swap ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      setPlayers((prev) => {
        const a = prev.find((p) => p.id === aId);
        const b = prev.find((p) => p.id === bId);
        if (!a || !b) return prev;

        // Structured mode: warn (never block) on duplicate positions.
        if (validationMode === "structured" && a.position && b.position && a.position === b.position) {
          toast({
            title: "Position note",
            description: `Both players are ${a.position}. Free movement allowed.`,
          });
        }

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
    (position: BasketballPosition) => {
      if (readOnly || !selectedPlayerId) return;
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === selectedPlayerId) return { ...p, position };
          // If another player was at that position, bench them.
          if (p.position === position) return { ...p, position: null };
          return p;
        })
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

  const addFoul = useCallback(
    (playerId: string) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId ? { ...p, fouls: Math.min(6, (p.fouls ?? 0) + 1) } : p
        )
      );
      const player = players.find((p) => p.id === playerId);
      const newCount = (player?.fouls ?? 0) + 1;
      if (newCount >= 5) {
        toast({
          title: "Fouled out",
          description: `${player?.name} has ${newCount} fouls.`,
          variant: "destructive",
        });
      }
    },
    [players, toast]
  );

  // ---------- Generate auto-sub plan when settings change ----------
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
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter]);

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
          <p className="text-[10px] text-muted-foreground">Basketball Game Board</p>
        </div>
        <BasketballQuarterTimer
          state={timerState}
          onChange={setTimerState}
          onTick={handleTick}
          onQuarterEnd={handleQuarterEnd}
          readOnly={readOnly}
        />
      </header>

      {!readOnly && (
        <BasketballActionBar
          onOpenSquad={() => setRosterOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onApplyLineup={applyNextLineupNow}
          currentQuarter={timerState.currentQuarter}
          rotationMode={rotationMode}
          rotationIntervalMinutes={rotationIntervalMinutes}
        />
      )}

      <BasketballCourtArea
        players={players}
        selectedPlayerId={selectedPlayerId}
        nextSubOutId={nextSub?.playerOut.id ?? null}
        readOnly={readOnly}
        onPlayerClick={handlePlayerClick}
        onSlotClick={handleSlotClick}
      />

      <BasketballBench
        bench={bench}
        selectedPlayerId={selectedPlayerId}
        readOnly={readOnly}
        onPlayerClick={handlePlayerClick}
      />

      <Suspense fallback={<DialogLoader />}>
        {settingsOpen && (
          <BasketballSettingsDialog
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
          <BasketballQuarterLineupPlanner
            open={lineupPlannerOpen}
            onOpenChange={setLineupPlannerOpen}
            players={players}
            lineups={quarterLineups}
            onSave={setQuarterLineups}
          />
        )}
        {rosterOpen && (
          <BasketballRosterDialog
            open={rosterOpen}
            onOpenChange={setRosterOpen}
            players={players}
            onSave={setPlayers}
          />
        )}
        {quickActionPlayerId && quickActionPlayer && (
          <BasketballQuickActionSheet
            open={!!quickActionPlayerId}
            onOpenChange={(o) => !o && setQuickActionPlayerId(null)}
            player={quickActionPlayer}
            onStartSwap={() => setSelectedPlayerId(quickActionPlayer.id)}
            onSubOff={() => subOff(quickActionPlayer.id)}
            onSubOn={() => setSelectedPlayerId(quickActionPlayer.id)}
            onToggleInjured={() => toggleInjured(quickActionPlayer.id)}
            onAddFoul={() => addFoul(quickActionPlayer.id)}
          />
        )}
      </Suspense>
    </div>
  );
}
