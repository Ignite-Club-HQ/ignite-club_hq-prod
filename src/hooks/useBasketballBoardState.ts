import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  BasketballBoardState,
  BasketballTimerState,
  BasketballLineupPreset,
  BasketballCourtView,
  Quarter,
  QuarterLineup,
  RotationMode,
  ValidationMode,
  BasketballSubEvent,
  getBasketballStateKey,
  getBasketballTimerKey,
  getBasketballPresetsKey,
} from "@/components/basketball/types";
import {
  getBench,
  applyLineup,
  generateTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan,
  findNextDueSub,
  safeLoad,
  safeSave,
} from "@/components/basketball/basketballHelpers";
import { useBasketballGameSync } from "@/hooks/useBasketballGameSync";

interface Member {
  id: string;
  user_id: string;
  role: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

interface UseBasketballBoardStateArgs {
  teamId: string;
  members: Member[];
  readOnly: boolean;
  initialMinutesPerQuarter: number;
}

/**
 * Encapsulates ALL state, persistence, sync, and game-logic handlers for the
 * basketball board. Keeps the BasketballBoard component focused on layout.
 */
export function useBasketballBoardState({
  teamId,
  members,
  readOnly,
  initialMinutesPerQuarter,
}: UseBasketballBoardStateArgs) {
  const { toast } = useToast();
  const stateKey = getBasketballStateKey(teamId);
  const timerKey = getBasketballTimerKey(teamId);

  // ---------- One-time load of saved state ----------
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

  // ---------- Core state ----------
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

  const [timerState, setTimerState] = useState<BasketballTimerState>(
    () =>
      savedTimerRef.current ?? {
        minutesPerQuarter: initialMinutesPerQuarter,
        currentQuarter: 1,
        elapsedSeconds: 0,
        isRunning: false,
        lastUpdateTime: Date.now(),
      }
  );

  // UI state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [quickActionPlayerId, setQuickActionPlayerId] = useState<string | null>(null);
  const [pendingQuarterSubs, setPendingQuarterSubs] = useState<{
    quarter: Quarter;
    subs: BasketballSubEvent[];
  } | null>(null);
  const [courtView, setCourtView] = useState<BasketballCourtView>("half");

  // Lineup presets (own localStorage key, separate from board state)
  const presetsKey = getBasketballPresetsKey(teamId);
  const [lineupPresets, setLineupPresetsState] = useState<BasketballLineupPreset[]>(
    () => safeLoad<BasketballLineupPreset[]>(presetsKey) ?? []
  );
  const setLineupPresets = useCallback(
    (next: BasketballLineupPreset[]) => {
      setLineupPresetsState(next);
      safeSave(presetsKey, next);
    },
    [presetsKey]
  );
  const toggleCourtView = useCallback(
    () => setCourtView((v) => (v === "half" ? "full" : "half")),
    []
  );

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

  // ---------- Aggregated board state ----------
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
  useEffect(() => {
    safeSave(stateKey, boardState);
  }, [boardState, stateKey]);
  useEffect(() => {
    safeSave(timerKey, timerState);
  }, [timerState, timerKey]);
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
      setAutoSubPlan((prev) =>
        prev.map((s) => (s === sub ? { ...s, executed: true } : s))
      );
      toast({
        title: "Auto-sub",
        description: `${sub.playerIn.name} ON for ${sub.playerOut.name} at ${sub.position}`,
      });
    },
    [toast]
  );

  // ---------- Time tracking ----------
  // `delta` is the number of real seconds elapsed since the last tick — using
  // a hard-coded `1` causes drift after the app backgrounds (the timer keeps
  // ticking via wall-clock but per-player minutes wouldn't catch up).
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
          (s) => !s.executed && !s.skipped && s.quarter === nextQuarter && s.time === 0
        );
        if (dueSubs.length > 0) {
          // Show preview — coach approves before applying.
          setPendingQuarterSubs({ quarter: nextQuarter, subs: dueSubs });
        }
      }
    },
    [autoSubPlan, quarterLineups, rotationMode, toast]
  );

  const confirmPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    pendingQuarterSubs.subs.forEach(executeSub);
    setPendingQuarterSubs(null);
  }, [executeSub, pendingQuarterSubs]);

  const skipPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    const skipped = new Set(pendingQuarterSubs.subs);
    setAutoSubPlan((prev) =>
      prev.map((s) => (skipped.has(s) ? { ...s, skipped: true } : s))
    );
    setPendingQuarterSubs(null);
    toast({ title: "Subs skipped", description: `Q${pendingQuarterSubs.quarter} rotation cleared.` });
  }, [pendingQuarterSubs, toast]);

  // ---------- Manual swap ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      setPlayers((prev) => {
        const a = prev.find((p) => p.id === aId);
        const b = prev.find((p) => p.id === bId);
        if (!a || !b) return prev;
        if (
          validationMode === "structured" &&
          a.position &&
          b.position &&
          a.position === b.position
        ) {
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
          if (p.position === position) return { ...p, position: null };
          return p;
        })
      );
      setSelectedPlayerId(null);
    },
    [readOnly, selectedPlayerId]
  );

  const subOff = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, position: null } : p))
    );
  }, []);

  const toggleInjured = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
  }, []);

  const addFoul = useCallback(
    (playerId: string) => {
      let newCount = 0;
      let playerName = "";
      let wasOnCourt = false;
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === playerId) {
            newCount = Math.min(6, (p.fouls ?? 0) + 1);
            playerName = p.name;
            wasOnCourt = p.position !== null;
            // At 5 fouls (FIBA) → fouled out: bench immediately and lock out
            // by also marking injured so the auto-sub engine ignores them.
            const fouledOut = newCount >= 5;
            return {
              ...p,
              fouls: newCount,
              position: fouledOut ? null : p.position,
              isInjured: fouledOut ? true : p.isInjured,
            };
          }
          return p;
        })
      );
      if (newCount >= 5) {
        toast({
          title: "Fouled out",
          description: wasOnCourt
            ? `${playerName} (${newCount}F) sent to bench. Tap to clear if needed.`
            : `${playerName} has ${newCount} fouls and is locked out.`,
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  // ---------- Generate auto-sub plan when settings or roster change ----------
  // Signature changes when bench composition or on-court positions change,
  // so manual swaps + roster edits trigger a fresh plan (no stale closure).
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
        generateTimeBasedRotationPlan(
          players,
          rotationIntervalMinutes,
          timerState.minutesPerQuarter
        )
      );
    } else if (rotationMode === "quarter-break") {
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter, rosterSignature]);

  // ---------- Derived ----------
  const bench = useMemo(() => getBench(players), [players]);
  const nextSub = useMemo(
    () =>
      findNextDueSub(
        autoSubPlan,
        timerState.currentQuarter,
        timerState.elapsedSeconds + 30
      ),
    [autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds]
  );
  const quickActionPlayer = useMemo(
    () => players.find((p) => p.id === quickActionPlayerId) ?? null,
    [players, quickActionPlayerId]
  );

  const applyNextLineupNow = useCallback(() => {
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
  }, [quarterLineups, timerState.currentQuarter, toast]);

  const applyPreset = useCallback(
    (preset: BasketballLineupPreset) => {
      setPlayers((prev) =>
        applyLineup(prev, {
          quarter: timerState.currentQuarter,
          assignments: preset.assignments,
          createdAt: preset.createdAt,
        })
      );
    },
    [timerState.currentQuarter]
  );

  return {
    // state
    players,
    setPlayers,
    rotationMode,
    setRotationMode,
    rotationIntervalMinutes,
    setRotationIntervalMinutes,
    validationMode,
    setValidationMode,
    quarterLineups,
    setQuarterLineups,
    timerState,
    setTimerState,
    selectedPlayerId,
    setSelectedPlayerId,
    quickActionPlayerId,
    setQuickActionPlayerId,
    pendingQuarterSubs,
    confirmPendingQuarterSubs,
    skipPendingQuarterSubs,
    // derived
    bench,
    nextSub,
    quickActionPlayer,
    // handlers
    handleTick,
    handleQuarterEnd,
    handlePlayerClick,
    handleSlotClick,
    subOff,
    toggleInjured,
    addFoul,
    applyNextLineupNow,
    // presets + view
    lineupPresets,
    setLineupPresets,
    applyPreset,
    courtView,
    toggleCourtView,
    // scoring
    addScore,
    undoScore,
    setOpponentName,
  };
}
