import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Loader2, Trophy, Undo2, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LinkedEventHeader } from "@/components/pitch/LinkedEventHeader";
import { SyncStatusIndicator } from "@/components/pitch/SyncStatusIndicator";
import { supabase } from "@/integrations/supabase/client";

import NetballQuarterTimer from "./NetballQuarterTimer";
import NetballActionBar from "./NetballActionBar";
import NetballCourtArea from "./NetballCourtArea";
import NetballBench from "./NetballBench";
import GameScoreboard from "@/components/scoreboard/GameScoreboard";
import QuarterScoreStrip from "@/components/scoreboard/QuarterScoreStrip";
import CentrePassIndicator from "@/components/scoreboard/CentrePassIndicator";
import CentrePassStatsPanel from "./CentrePassStatsPanel";
import BenchFairnessMeter from "@/components/scoreboard/BenchFairnessMeter";
import MomentumStrip from "@/components/scoreboard/MomentumStrip";
import FoulFatigueWatchlist from "@/components/scoreboard/FoulFatigueWatchlist";
import SmartSubSuggestion from "@/components/scoreboard/SmartSubSuggestion";
import CuesToggle from "@/components/scoreboard/CuesToggle";
import QuarterAutoSubControlPanel from "@/components/scoreboard/QuarterAutoSubControlPanel";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useSaveGameResult } from "@/hooks/useSaveGameResult";
import { useCourtBoardDefaults } from "@/hooks/useCourtBoardDefaults";
import { cueQuarterEnd, cueSubDue } from "@/lib/gameCues";
import { hapticImpactLight, hapticImpactMedium, hapticSelectionTick } from "@/lib/haptics";

import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  NetballBoardState,
  NetballTimerState,
  NetballSubLogEntry,
  NetballLineupPreset,
  Quarter,
  QuarterLineup,
  RotationMode,
  ValidationMode,
  NetballSubEvent,
  getNetballStateKey,
  getNetballTimerKey,
  getNetballPresetsKey,
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
import { visiblePeriods, totalElapsedSeconds } from "@/lib/periodTypes";
import { trimLog, SUB_LOG_MAX, SCORE_LOG_MAX, CENTRE_PASS_LOG_MAX } from "@/lib/gameLogLimits";

// Lazy-load secondary dialogs
const NetballSettingsDialog = lazy(() => import("./NetballSettingsDialog"));
const QuarterLineupPlanner = lazy(() => import("./QuarterLineupPlanner"));
const NetballLineupPresetsDialog = lazy(() => import("./NetballLineupPresetsDialog"));
const NetballRosterDialog = lazy(() => import("./NetballRosterDialog"));
const NetballQuickActionSheet = lazy(() => import("./NetballQuickActionSheet"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));
import PreTipoffHint from "@/components/scoreboard/PreTipoffHint";

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

  // ---------- Linked event lifecycle (mirrors soccer pitch board) ----------
  const [linkedEventId, setLinkedEventId] = useState<string | null>(eventId);
  useEffect(() => {
    setLinkedEventId(eventId);
  }, [eventId]);

  const { data: linkedEvent } = useQuery({
    queryKey: ["netball-linked-event", linkedEventId],
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

  // Per-team default board settings (loaded once from team_subscriptions.court_*).
  const { defaults, isLoading: defaultsLoading, persist: persistDefaults } =
    useCourtBoardDefaults(teamId, readOnly);
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultsLoading || defaultsAppliedRef.current) return;
    defaultsAppliedRef.current = true;
    if (defaults.minutesPerQuarter != null) {
      setTimerState((s) => ({
        ...s,
        minutesPerQuarter: defaults.minutesPerQuarter!,
        lastUpdateTime: Date.now(),
      }));
    }
    if (defaults.rotationMode) setRotationMode(defaults.rotationMode);
    if (defaults.rotationIntervalMinutes != null)
      setRotationIntervalMinutes(defaults.rotationIntervalMinutes);
    if (
      defaults.validationMode === "free" ||
      defaults.validationMode === "warn" ||
      defaults.validationMode === "strict"
    ) {
      setValidationMode(defaults.validationMode);
    }
    if (defaults.periodType) {
      setTimerState((s) => ({ ...s, periodType: defaults.periodType!, lastUpdateTime: Date.now() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsLoading]);

  // UI state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineupPlannerOpen, setLineupPlannerOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);

  // Lineup presets — own localStorage key, scoped by team (shared across matches).
  const presetsKey = getNetballPresetsKey(teamId);
  const [lineupPresets, setLineupPresetsState] = useState<NetballLineupPreset[]>(
    () => safeLoad<NetballLineupPreset[]>(presetsKey) ?? []
  );
  const setLineupPresets = useCallback(
    (next: NetballLineupPreset[]) => {
      setLineupPresetsState(next);
      safeSave(presetsKey, next);
    },
    [presetsKey]
  );
  const applyPreset = useCallback(
    (preset: NetballLineupPreset) => {
      setPlayers((prev) =>
        applyLineup(prev, {
          quarter: timerState.currentQuarter,
          assignments: preset.assignments,
          createdAt: preset.createdAt,
        })
      );
      toast({ title: `"${preset.name}" applied` });
    },
    [timerState.currentQuarter, toast]
  );
  const [quickActionPlayerId, setQuickActionPlayerId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Auto-sub control panel state
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  const [autoSubPaused, setAutoSubPaused] = useState(
    savedStateRef.current?.autoSubPaused ?? false
  );
  const [lockedPlayerIds, setLockedPlayerIds] = useState<Set<string>>(
    new Set(savedStateRef.current?.lockedPlayerIds ?? [])
  );
  const toggleAutoSubPaused = useCallback(() => setAutoSubPaused((p) => !p), []);
  const toggleLockPlayer = useCallback((playerId: string) => {
    setLockedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  // Auto-open the summary the first time the game ticks over to "finished".
  useEffect(() => {
    if (timerState.isGameFinished) setSummaryOpen(true);
  }, [timerState.isGameFinished]);

  // ---------- Sub log writer (single funnel for auto + manual subs) ----------
  const appendSubLog = useCallback(
    (entry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time">) => {
      setTimerState((s) => ({
        ...s,
        subLog: trimLog(
          [
            ...(s.subLog ?? []),
            {
              ...entry,
              id: crypto.randomUUID(),
              at: Date.now(),
              quarter: s.currentQuarter,
              time: s.elapsedSeconds,
            },
          ],
          SUB_LOG_MAX
        ),
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
      autoSubPaused,
      // Persist locked IDs as a plain array (Set isn't JSON-friendly).
      lockedPlayerIds: Array.from(lockedPlayerIds),
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
      autoSubPaused,
      lockedPlayerIds,
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

      if (rotationMode !== "off" && !autoSubPaused) {
        const upcoming = findNextDueSub(autoSubPlan, quarter, elapsed + 10);
        if (
          upcoming &&
          upcoming.time > elapsed &&
          !lockedPlayerIds.has(upcoming.playerOut.id)
        ) {
          const key = `${quarter}:${upcoming.time}:${upcoming.playerOut.id}`;
          if (!cuedSubIdsRef.current.has(key)) {
            cuedSubIdsRef.current.add(key);
            cueSubDue();
          }
        }
        const due = findNextDueSub(autoSubPlan, quarter, elapsed);
        if (due && !lockedPlayerIds.has(due.playerOut.id)) executeSub(due);
      }
    },
    [autoSubPlan, rotationMode, autoSubPaused, lockedPlayerIds] // executeSub stable via setState callbacks
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
      // In halves mode the visible periods are [1, 3] — slot 1 ("H1") rolls
      // straight to slot 3 ("H2"), skipping slot 2. Using `endedQuarter + 1`
      // silently broke quarterLineups + quarter-break rotations for halves.
      const periodType = timerState.periodType;
      const periods = visiblePeriods(periodType);
      const idx = periods.indexOf(endedQuarter);
      const isFinalPeriod = idx === periods.length - 1;
      const nextQuarter = (periods[idx + 1] ?? null) as Quarter | null;
      if (isFinalPeriod || nextQuarter === null) {
        toast({
          title: "Game finished",
          description: periodType === "halves" ? "H2 complete." : "Q4 complete.",
        });
        return;
      }
      const nextLineup = quarterLineups.find((l) => l.quarter === nextQuarter);
      if (nextLineup && Object.keys(nextLineup.assignments).length > 0) {
        setPlayers((prev) => applyLineup(prev, nextLineup));
        toast({
          title: `${periodType === "halves" ? "H" + (nextQuarter <= 2 ? 1 : 2) : "Q" + nextQuarter} lineup applied`,
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
    [autoSubPlan, executeSub, quarterLineups, rotationMode, toast, timerState.periodType]
  );

  // ---------- Manual swap / sub interactions ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      hapticImpactMedium();
      let logEntry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time"> | null = null;
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

        // Bench → court swap counts as a sub for undo + summary purposes.
        if (a.position === null && b.position !== null) {
          logEntry = {
            playerOutId: b.id,
            playerOutName: b.name,
            playerInId: a.id,
            playerInName: a.name,
            position: b.position,
            source: "manual",
          };
        } else if (b.position === null && a.position !== null) {
          logEntry = {
            playerOutId: a.id,
            playerOutName: a.name,
            playerInId: b.id,
            playerInName: b.name,
            position: a.position,
            source: "manual",
          };
        }

        return prev.map((p) => {
          if (p.id === a.id) return { ...p, position: b.position };
          if (p.id === b.id) return { ...p, position: a.position };
          return p;
        });
      });
      if (logEntry) appendSubLog(logEntry);
    },
    [validationMode, toast, appendSubLog]
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
    hapticSelectionTick();
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
  // We also mark the most recent centre-pass entry for the scoring side as
  // "converted" — that's the input the win-rate panel needs.
  const addScore = useCallback((side: "home" | "away", points: number, playerId?: string) => {
    hapticImpactLight();
    setTimerState((s) => {
      const event = {
        id: crypto.randomUUID(),
        side,
        points,
        quarter: s.currentQuarter,
        at: Date.now(),
        playerId: side === "home" ? playerId : undefined,
      };
      const cpLog = [...(s.centrePassLog ?? [])];
      // First goal of the game? Seed the opening centre-pass entry so it can
      // be credited if the side that took it scored first.
      if (cpLog.length === 0) {
        cpLog.push({
          id: crypto.randomUUID(),
          quarter: s.currentQuarter,
          side: s.centrePass ?? "home",
          converted: false,
          at: Date.now() - 1,
        });
      }
      // Walk backwards to find the most recent UNCONVERTED CP for the scoring
      // side in this quarter. If we score before the CP flips again, we win it.
      for (let i = cpLog.length - 1; i >= 0; i--) {
        const cp = cpLog[i];
        if (cp.quarter !== s.currentQuarter) break;
        if (cp.side === side && !cp.converted) {
          cpLog[i] = { ...cp, converted: true };
          break;
        }
        // If we hit the OTHER side's CP first, that means possession already
        // flipped — no conversion to credit.
        if (cp.side !== side) break;
      }
      // After the goal the OPPOSITE side takes the next centre pass — log it.
      const next: "home" | "away" = side === "home" ? "away" : "home";
      cpLog.push({
        id: crypto.randomUUID(),
        quarter: s.currentQuarter,
        side: next,
        converted: false,
        at: Date.now() + 1,
      });
      return {
        ...s,
        homeScore: (s.homeScore ?? 0) + (side === "home" ? points : 0),
        awayScore: (s.awayScore ?? 0) + (side === "away" ? points : 0),
        scoreLog: trimLog([...(s.scoreLog ?? []), event], SCORE_LOG_MAX),
        centrePass: next,
        centrePassLog: trimLog(cpLog, CENTRE_PASS_LOG_MAX),
        lastUpdateTime: Date.now(),
      };
    });
    if (side === "home" && playerId) {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId ? { ...p, goals: (p.goals ?? 0) + points } : p
        )
      );
    }
  }, []);

  const undoScore = useCallback(() => {
    setTimerState((s) => {
      const log = s.scoreLog ?? [];
      if (log.length === 0) return s;
      const last = log[log.length - 1];
      // Roll back per-player goals if the last score was attributed.
      if (last.side === "home" && last.playerId) {
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === last.playerId
              ? { ...p, goals: Math.max(0, (p.goals ?? 0) - last.points) }
              : p
          )
        );
      }
      // Roll back the centre-pass log too: drop the auto-pushed "next" CP and
      // unconvert the previous CP we credited.
      const cpLog = [...(s.centrePassLog ?? [])];
      if (cpLog.length > 0 && !cpLog[cpLog.length - 1].converted) {
        cpLog.pop();
      }
      for (let i = cpLog.length - 1; i >= 0; i--) {
        if (cpLog[i].side === last.side && cpLog[i].converted) {
          cpLog[i] = { ...cpLog[i], converted: false };
          break;
        }
      }
      return {
        ...s,
        homeScore: Math.max(0, (s.homeScore ?? 0) - (last.side === "home" ? last.points : 0)),
        awayScore: Math.max(0, (s.awayScore ?? 0) - (last.side === "away" ? last.points : 0)),
        scoreLog: log.slice(0, -1),
        centrePass: last.side,
        centrePassLog: cpLog,
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

  // Default the opponent name from the linked event once, if the coach hasn't set one.
  useEffect(() => {
    if (!linkedEvent?.opponent) return;
    setTimerState((s) => {
      if (s.opponentName && s.opponentName !== "Opponent") return s;
      return { ...s, opponentName: linkedEvent.opponent!, lastUpdateTime: Date.now() };
    });
  }, [linkedEvent?.opponent]);

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
        generateTimeBasedRotationPlan(players, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType ?? "quarters")
      );
    } else if (rotationMode === "quarter-break") {
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 2, timerState.periodType ?? "quarters"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType, rosterSignature]);

  // ---------- Auto-sub control panel handlers ----------
  const findUpcomingSub = useCallback(() => {
    return (
      autoSubPlan.find(
        (s) =>
          !s.executed &&
          !s.skipped &&
          s.quarter === timerState.currentQuarter &&
          s.time >= timerState.elapsedSeconds
      ) ||
      autoSubPlan.find((s) => !s.executed && !s.skipped && s.quarter > timerState.currentQuarter) ||
      autoSubPlan.find((s) => !s.executed && !s.skipped)
    );
  }, [autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds]);

  const executeNextSubNow = useCallback(() => {
    const target = findUpcomingSub();
    if (!target) {
      toast({ title: "No subs queued" });
      return;
    }
    executeSub(target);
  }, [findUpcomingSub, executeSub, toast]);

  const skipNextSub = useCallback(() => {
    const target = findUpcomingSub();
    if (!target) return;
    setAutoSubPlan((prev) =>
      prev.map((s) =>
        !s.executed && !s.skipped && s.quarter === target.quarter && s.time === target.time
          ? { ...s, skipped: true }
          : s
      )
    );
    toast({ title: "Sub skipped" });
  }, [findUpcomingSub, toast]);

  const cancelAutoSubPlan = useCallback(() => {
    setAutoSubPlan((prev) => prev.map((s) => (s.executed ? s : { ...s, skipped: true })));
    toast({ title: "Plan cancelled", description: "All pending auto-subs cleared." });
  }, [toast]);

  const regenerateAutoSubPlan = useCallback(() => {
    if (rotationMode === "off") {
      toast({
        title: "Rotation is off",
        description: "Enable a rotation mode in Settings first.",
        variant: "destructive",
      });
      return;
    }
    const fresh =
      rotationMode === "time-based"
        ? generateTimeBasedRotationPlan(players, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType ?? "quarters")
        : generateQuarterBreakRotationPlan(players, 2, timerState.periodType ?? "quarters");
    const executed = autoSubPlan.filter((s) => s.executed);
    setAutoSubPlan([
      ...executed,
      ...fresh.filter(
        (f) =>
          !executed.some(
            (e) =>
              e.quarter === f.quarter && e.time === f.time && e.playerOut.id === f.playerOut.id
          )
      ),
    ]);
    toast({ title: "Plan regenerated" });
  }, [rotationMode, players, rotationIntervalMinutes, timerState.minutesPerQuarter, autoSubPlan, toast]);

  const onCourtForPanel = useMemo(
    () =>
      players
        .filter((p) => p.position !== null)
        .map((p) => ({ id: p.id, name: p.name, number: p.number, position: p.position })),
    [players]
  );

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
        // Surface attributable goals as `points` so GameSummaryDialog renders them.
        points: p.goals ?? 0,
        isInjured: !!p.isInjured,
        finalPosition: p.position ?? null,
      })),
    [players]
  );

  const perQuarter = useMemo(() => {
    const log = timerState.scoreLog ?? [];
    const periods = visiblePeriods(timerState.periodType);
    return periods.map((slot, idx) => {
      // In halves mode, slot 1 represents H1 (Q1+Q2), slot 3 represents H2 (Q3+Q4).
      const matches = (q: number) =>
        timerState.periodType === "halves"
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
  }, [timerState.scoreLog, timerState.periodType]);

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

  // Auto-save the finished game to history (admins/coaches only — RLS guards the rest).
  const { save: saveGameResult, saved: gameSaved } = useSaveGameResult();
  useEffect(() => {
    if (!readOnly && timerState.isGameFinished) {
      saveGameResult({
        teamId,
        eventId,
        sport: "netball",
        homeLabel: teamName,
        awayLabel: timerState.opponentName ?? "Opponent",
        homeScore: timerState.homeScore ?? 0,
        awayScore: timerState.awayScore ?? 0,
        perQuarter,
        players: summaryPlayers,
        mvpPlayerId: timerState.mvpPlayerId ?? null,
      });
    }
  }, [
    readOnly,
    timerState.isGameFinished,
    timerState.mvpPlayerId,
    teamId,
    eventId,
    teamName,
    timerState.opponentName,
    timerState.homeScore,
    timerState.awayScore,
    perQuarter,
    summaryPlayers,
    saveGameResult,
  ]);

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
        <SyncStatusIndicator />
        <CuesToggle />
        <NetballQuarterTimer
          state={timerState}
          onChange={setTimerState}
          onTick={handleTick}
          onQuarterEnd={handleQuarterEnd}
          readOnly={readOnly}
        />
      </header>

      {/* Linked event header (link/unlink a scheduled match). */}
      <LinkedEventHeader
        eventId={linkedEventId || ""}
        teamId={teamId}
        teamName={teamName}
        compact
        onLinkEvent={readOnly ? undefined : setLinkedEventId}
        currentScore={{
          team: timerState.homeScore ?? 0,
          opponent: timerState.awayScore ?? 0,
        }}
        isGameInProgress={!!timerState.isRunning && !timerState.isGameFinished}
      />

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
        periodType={timerState.periodType ?? "quarters"}
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

      <CentrePassStatsPanel
        homeLabel={teamName}
        awayLabel={timerState.opponentName ?? "Opponent"}
        log={timerState.centrePassLog}
        currentQuarter={timerState.currentQuarter}
      />

      <BenchFairnessMeter
        players={players}
        elapsedSeconds={totalElapsedSeconds(
          timerState.currentQuarter,
          timerState.elapsedSeconds,
          timerState.minutesPerQuarter,
          timerState.periodType
        )}
      />

      <MomentumStrip scoreLog={timerState.scoreLog} />

      <FoulFatigueWatchlist
        sport="netball"
        players={players}
        currentQuarter={timerState.currentQuarter}
        totalElapsedSeconds={totalElapsedSeconds(
          timerState.currentQuarter,
          timerState.elapsedSeconds,
          timerState.minutesPerQuarter,
          timerState.periodType
        )}
        minutesPerQuarter={timerState.minutesPerQuarter}
      />

      {!readOnly && (
        <SmartSubSuggestion
          players={players}
          totalElapsedSeconds={totalElapsedSeconds(
            timerState.currentQuarter,
            timerState.elapsedSeconds,
            timerState.minutesPerQuarter,
            timerState.periodType
          )}
          isRunning={timerState.isRunning && !timerState.isGameFinished}
          onApplySub={(outId, inId) => performSwap(outId, inId)}
        />
      )}

      {!readOnly && (
        <NetballActionBar
          onOpenSquad={() => setRosterOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onApplyLineup={applyNextLineupNow}
          currentQuarter={timerState.currentQuarter}
          rotationMode={rotationMode}
          rotationIntervalMinutes={rotationIntervalMinutes}
        />
      )}

      {/* Pre-tipoff nudge: only before the very first whistle. */}
      {!readOnly &&
        timerState.currentQuarter === 1 &&
        timerState.elapsedSeconds === 0 &&
        !timerState.isRunning &&
        !timerState.isGameFinished && (
          <PreTipoffHint
            required={7}
            currentOnCourt={getOnCourt(players).length}
            onOpenPlanner={() => setLineupPlannerOpen(true)}
            onOpenPresets={() => setPresetsOpen(true)}
            hasPresets={lineupPresets.length > 0}
          />
        )}

      {!readOnly && rotationMode !== "off" && autoSubPlan.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-primary/5">
          <span className="text-[11px] text-muted-foreground">
            Auto-subs: {autoSubPlan.filter((s) => s.executed).length}/{autoSubPlan.length}
            {autoSubPaused && <span className="ml-1.5 text-amber-600 font-medium">· Paused</span>}
            {lockedPlayerIds.size > 0 && (
              <span className="ml-1.5 text-amber-600">· {lockedPlayerIds.size} locked</span>
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
            onMinutesPerQuarterChange={(n) => {
              setTimerState((s) => ({ ...s, minutesPerQuarter: n, lastUpdateTime: Date.now() }));
              persistDefaults({ court_minutes_per_quarter: n });
            }}
            rotationMode={rotationMode}
            onRotationModeChange={(m) => {
              setRotationMode(m);
              persistDefaults({ court_rotation_mode: m });
            }}
            rotationIntervalMinutes={rotationIntervalMinutes}
            onRotationIntervalChange={(n) => {
              setRotationIntervalMinutes(n);
              persistDefaults({ court_rotation_interval_minutes: n });
            }}
            validationMode={validationMode}
            onValidationModeChange={(m) => {
              setValidationMode(m);
              persistDefaults({ court_validation_mode: m });
            }}
            periodType={timerState.periodType ?? "quarters"}
            onPeriodTypeChange={(p) => {
              setPeriodType(p);
              persistDefaults({ court_period_type: p });
            }}
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
        {presetsOpen && (
          <NetballLineupPresetsDialog
            open={presetsOpen}
            onOpenChange={setPresetsOpen}
            players={players}
            presets={lineupPresets}
            onSave={setLineupPresets}
            onApply={applyPreset}
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
            onScore={() => addScore("home", 1, quickActionPlayer.id)}
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
            isSaved={gameSaved}
            onSaveNow={() =>
              saveGameResult(
                {
                  teamId,
                  eventId,
                  sport: "netball",
                  homeLabel: teamName,
                  awayLabel: timerState.opponentName ?? "Opponent",
                  homeScore: timerState.homeScore ?? 0,
                  awayScore: timerState.awayScore ?? 0,
                  perQuarter,
                  players: summaryPlayers,
                  mvpPlayerId: timerState.mvpPlayerId ?? null,
                },
                { force: true }
              )
            }
          />
        )}
      </Suspense>

      <QuarterAutoSubControlPanel
        open={autoSubPanelOpen}
        onClose={() => setAutoSubPanelOpen(false)}
        autoSubPlan={autoSubPlan}
        autoSubPaused={autoSubPaused}
        onPlayers={onCourtForPanel}
        lockedPlayerIds={lockedPlayerIds}
        currentQuarter={timerState.currentQuarter}
        currentElapsedSeconds={timerState.elapsedSeconds}
        minutesPerQuarter={timerState.minutesPerQuarter}
        periodType={timerState.periodType}
        onTogglePause={toggleAutoSubPaused}
        onCancelPlan={cancelAutoSubPlan}
        onSkipNext={skipNextSub}
        onExecuteNow={executeNextSubNow}
        onRegeneratePlan={regenerateAutoSubPlan}
        onToggleLockPlayer={toggleLockPlayer}
        onEditPlan={() => setLineupPlannerOpen(true)}
      />
    </div>
  );
}
