import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Loader2, Trophy, Undo2, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LinkedEventHeader } from "@/components/pitch/LinkedEventHeader";
import { SyncStatusIndicator } from "@/components/pitch/SyncStatusIndicator";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import NetballQuarterTimer from "./NetballQuarterTimer";
import LiveGameHUD from "@/components/basketball/LiveGameHUD";
import NetballLiveHUD from "./NetballLiveHUD";

import NetballLiveActionBar from "./NetballLiveActionBar";
import NetballActionBar from "./NetballActionBar";
import NetballCourtArea from "./NetballCourtArea";
import NetballBench from "./NetballBench";
import SubModeBanner from "./SubModeBanner";
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
import { useSubConfirm } from "@/hooks/useSubConfirm";
import { useAutoSubNotify } from "@/hooks/useAutoSubNotify";
import SubConfirmDialog from "@/components/scoreboard/SubConfirmDialog";
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
  getSubKey,
  safeLoad,
  safeSave,
  transitionPosition,
} from "./netballHelpers";
import { useNetballGameSync } from "@/hooks/useNetballGameSync";
import { visiblePeriods, totalElapsedSeconds, periodLabel } from "@/lib/periodTypes";
import { trimLog, SUB_LOG_MAX, SCORE_LOG_MAX, CENTRE_PASS_LOG_MAX } from "@/lib/gameLogLimits";

// Lazy-load secondary dialogs
const NetballSettingsDialog = lazy(() => import("./NetballSettingsDialog"));
const NetballGameSettingsDialog = lazy(() => import("./NetballGameSettingsDialog"));
const QuarterLineupPlanner = lazy(() => import("./QuarterLineupPlanner"));
const NetballLineupPresetsDialog = lazy(() => import("./NetballLineupPresetsDialog"));
const NetballRosterDialog = lazy(() => import("./NetballRosterDialog"));
const NetballQuickActionSheet = lazy(() => import("./NetballQuickActionSheet"));
const NetballGoalScorerSheet = lazy(() => import("./NetballGoalScorerSheet"));
const NetballPlayerCard = lazy(() => import("./NetballPlayerCard"));
const GameSummaryDialog = lazy(() => import("@/components/scoreboard/GameSummaryDialog"));
import NetballPreGameScreen from "./NetballPreGameScreen";
import NetballQuarterBreakDialog from "./NetballQuarterBreakDialog";
import NetballKickoffConfirm from "./NetballKickoffConfirm";

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
    // ROSTER SEEDING: strictly player-role only (matches basketball board).
    // Children assigned to the team are passed in as role:"player" too.
    // Parents, coaches, and admins are NOT part of the squad — coaches add
    // them via the roster dialog or via the "Add 12 mocks" shortcut.
    const playersOnly = members.filter((m) => m.role === "player");
    return playersOnly.slice(0, 14).map((m, idx) => ({
      id: m.id,
      name: m.profiles?.display_name?.trim() || `Player ${idx + 1}`,
      position: idx < 7 ? NETBALL_POSITIONS[idx] : null,
      minutesPlayed: 0,
      goals: 0,
      preferredPositions: [],
    }));
  };

  const [players, setPlayers] = useState<NetballPlayer[]>(buildInitialPlayers);

  // Hydrate squad once members arrive (fetch is async — on first mount
  // `members` is often empty, and without this effect the roster dialog
  // would stay empty forever).
  useEffect(() => {
    if (players.length > 0) return;
    if (!members || members.length === 0) return;
    if (savedStateRef.current?.players?.length) return;
    setPlayers(buildInitialPlayers());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);
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
        // Seed an opening centre-pass side so first-goal credit and CP stats
        // populate from kickoff (audit fix B15/N15-init). Coach can flip via
        // the CentrePassIndicator before tipoff.
        centrePass: "home",
      }
    );
  });
  // Mirror into a ref so callbacks (e.g. handleQuarterEnd) can read the
  // latest periodType without taking it as a dep — fixes audit N11 where
  // toggling halves/quarters mid-game saw a stale closure.
  const timerStateRef = useRef(timerState);
  useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

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

  // HUD position — coaches can flip the live HUD between top and bottom of
  // the court. Persisted per-device so the preference survives reloads.
  const HUD_POSITION_KEY = "netball:hudPosition";
  const [hudPosition, setHudPosition] = useState<"top" | "bottom">(() => {
    if (typeof window === "undefined") return "top";
    const v = window.localStorage.getItem(HUD_POSITION_KEY);
    return v === "bottom" ? "bottom" : "top";
  });
  const toggleHudPosition = useCallback(() => {
    setHudPosition((prev) => {
      const next = prev === "top" ? "bottom" : "top";
      try {
        window.localStorage.setItem(HUD_POSITION_KEY, next);
      } catch {
        /* ignore */
      }
      hapticSelectionTick();
      return next;
    });
  }, []);

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
  // Player info card — shown on a single tap when Sub Mode is OFF. Surfaces
  // name, time played, and sub status with a primary "Sub" CTA.
  const [infoCardPlayerId, setInfoCardPlayerId] = useState<string | null>(null);
  // Persistent Sub Mode toggle — when ON, tap-to-arm + tap-to-swap behaviour
  // (the historical fast flow). When OFF, tap opens the info card instead.
  const [subModeActive, setSubModeActive] = useState(false);
  const [goalScorerOpen, setGoalScorerOpen] = useState(false);
  // Tracks which side a long-pressed score belongs to (home or away). Drives
  // the scorer attribution sheet for the correct team.
  const [scorerSide, setScorerSide] = useState<"home" | "away">("home");
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Pending quarter-break subs — surfaced in NetballQuarterBreakDialog so the
  // coach approves rotations instead of having them apply silently.
  const [pendingQuarterSubs, setPendingQuarterSubs] = useState<{
    quarter: Quarter;
    subs: NetballSubEvent[];
  } | null>(null);
  // Brief glow on the two tokens involved in the most recent swap.
  const [recentlySwappedIds, setRecentlySwappedIds] = useState<string[]>([]);
  const recentClearTimerRef = useRef<number | null>(null);
  const flashRecentSwap = useCallback((ids: string[]) => {
    setRecentlySwappedIds(ids);
    if (recentClearTimerRef.current != null) {
      window.clearTimeout(recentClearTimerRef.current);
    }
    recentClearTimerRef.current = window.setTimeout(() => {
      setRecentlySwappedIds([]);
      recentClearTimerRef.current = null;
    }, 700);
  }, []);
  useEffect(
    () => () => {
      if (recentClearTimerRef.current != null) {
        window.clearTimeout(recentClearTimerRef.current);
      }
    },
    []
  );
  // Auto-sub control panel state
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  // True when the panel was opened from the pre-game screen — drives previewMode.
  const [autoSubPanelPreview, setAutoSubPanelPreview] = useState(false);
  // Tracks whether coach has previewed the plan this session — if not, the
  // kickoff reminder fires when they tap "Ready to start" with auto-subs on.
  const [hasReviewedAutoSubs, setHasReviewedAutoSubs] = useState(false);
  const [kickoffConfirmOpen, setKickoffConfirmOpen] = useState(false);
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

  // ---------- Full reset (called from the timer's reset button) ----------
  // Wipes per-player stats AND any cached cue/sub state so a fresh game
  // starts cleanly. Without this, stale "ghost" sub cues would re-fire and
  // old goals/minutes would persist visually after a confirmed reset.
  const resetPlayerStats = useCallback(() => {
    cuedSubIdsRef.current = new Set();
    setAutoSubPlan((prev) => prev.map((s) => ({ ...s, executed: false, skipped: false })));
    setLockedPlayerIds(new Set());
    setAutoSubPaused(false);
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        minutesPlayed: 0,
        goals: 0,
        isInjured: false,
        lastBenchedAt: null,
      }))
    );
  }, []);
  // Forward ref so handleTick can call executeSub before it's declared
  // (audit fix N14 — temporal dead zone + missing dep).
  const executeSubRef = useRef<((sub: NetballSubEvent) => void) | null>(null);
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
        if (due && !lockedPlayerIds.has(due.playerOut.id)) executeSubRef.current?.(due);
      }
    },
    [autoSubPlan, rotationMode, autoSubPaused, lockedPlayerIds]
  );

  // ---------- Sub execution ----------
  // Push notifications for fired auto-subs go to all team admins/coaches so
  // assistant coaches on the sideline see the change without being on-board.
  const notifyAutoSub = useAutoSubNotify(teamId, teamName, linkedEventId);
  // Pending auto-sub awaiting coach confirmation. Mid-quarter timed subs are
  // staged here (instead of mutating immediately) so a confirmation dialog
  // surfaces — quarter-break subs continue using NetballQuarterBreakDialog.
  const [pendingAutoSub, setPendingAutoSub] = useState<NetballSubEvent | null>(null);
  // Track which sub keys have already been staged so the 1Hz tick can't
  // re-stage the same sub on every tick while the dialog is open.
  const stagedAutoSubKeysRef = useRef<Set<string>>(new Set());

  const applyAutoSub = useCallback(
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
      // Match by stable key, not object identity — `regenerateAutoSubPlan`
      // creates new SubEvent objects, so `s === sub` would silently miss and
      // the sub would re-fire every tick (audit fix N1).
      const subKey = getSubKey(sub);
      setAutoSubPlan((prev) =>
        prev.map((s) => (getSubKey(s) === subKey ? { ...s, executed: true } : s))
      );
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
      // Fire-and-forget push to admins/coaches. Period label gives context
      // when the recipient sees the push outside the app.
      const periodType = timerStateRef.current.periodType;
      const q = timerStateRef.current.currentQuarter;
      const periodLabel =
        periodType === "halves" ? `H${q <= 2 ? 1 : 2}` : `Q${q}`;
      void notifyAutoSub({
        playerInName: sub.playerIn.name,
        playerOutName: sub.playerOut.name,
        position: sub.position,
        periodLabel,
      });
    },
    [toast, appendSubLog, notifyAutoSub]
  );

  // Stage an auto-sub for confirmation instead of firing it directly. Called
  // from handleTick when a planned sub becomes due.
  const executeSub = useCallback(
    (sub: NetballSubEvent) => {
      const key = getSubKey(sub);
      if (stagedAutoSubKeysRef.current.has(key)) return;
      stagedAutoSubKeysRef.current.add(key);
      setPendingAutoSub(sub);
    },
    []
  );

  const confirmPendingAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    applyAutoSub(pendingAutoSub);
    setPendingAutoSub(null);
  }, [pendingAutoSub, applyAutoSub]);

  const cancelPendingAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    // Mark as skipped so handleTick doesn't immediately re-stage it on the
    // next tick — coach explicitly declined this rotation.
    const skippedKey = getSubKey(pendingAutoSub);
    setAutoSubPlan((prev) =>
      prev.map((s) => (getSubKey(s) === skippedKey ? { ...s, skipped: true } : s))
    );
    setPendingAutoSub(null);
  }, [pendingAutoSub]);
  // Wire the forward-ref so handleTick can fire executeSub safely (audit fix N14).
  useEffect(() => {
    executeSubRef.current = executeSub;
  }, [executeSub]);

  // ---------- Quarter end → quarter-break rotations + apply next lineup ----------
  const handleQuarterEnd = useCallback(
    (endedQuarter: Quarter) => {
      cueQuarterEnd();
      // In halves mode the visible periods are [1, 3] — slot 1 ("H1") rolls
      // straight to slot 3 ("H2"), skipping slot 2. Using `endedQuarter + 1`
      // silently broke quarterLineups + quarter-break rotations for halves.
      // Read periodType from the ref (audit fix N11) so toggling halves
      // mid-game doesn't trip a stale closure.
      const periodType = timerStateRef.current.periodType;
      const periods = visiblePeriods(periodType);
      const idx = periods.indexOf(endedQuarter);
      const isFinalPeriod = idx === periods.length - 1;
      const nextQuarter = (periods[idx + 1] ?? null) as Quarter | null;
      // Purge stale sub-cue keys for the ended quarter so cuedSubIdsRef
      // can't grow unbounded across long sessions (audit fix L5).
      const stalePrefix = `${endedQuarter}:`;
      cuedSubIdsRef.current.forEach((k) => {
        if (k.startsWith(stalePrefix)) cuedSubIdsRef.current.delete(k);
      });
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
          (s) => !s.executed && !s.skipped && s.quarter === nextQuarter && s.time === 0
        );
        if (dueSubs.length > 0) {
          // Surface the planned subs in NetballQuarterBreakDialog so the
          // coach approves them — mirrors basketball.
          setPendingQuarterSubs({ quarter: nextQuarter, subs: dueSubs });
        }
      }
    },
    [autoSubPlan, executeSub, quarterLineups, rotationMode, toast, appendSubLog]
  );

  // ---------- Manual swap / sub interactions ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      hapticImpactMedium();
      // Resolve players + validate BEFORE entering the state updater so we
      // never fire toasts inside setPlayers (audit fix N9 — toasts in
      // updaters can fire twice in StrictMode and during re-render storms).
      const a = players.find((p) => p.id === aId);
      const b = players.find((p) => p.id === bId);
      if (!a || !b) return;

      const validate = (
        who: NetballPlayer,
        pos: NetballPosition | null
      ): { ok: boolean; toast?: { title: string; description: string; variant?: "destructive" } } => {
        if (!pos) return { ok: true };
        if (validationMode === "free") return { ok: true };
        const allowed = isPositionAllowedForPlayer(who, pos);
        if (allowed) return { ok: true };
        if (validationMode === "warn") {
          return {
            ok: true,
            toast: {
              title: "Position warning",
              description: `${who.name} isn't a preferred ${pos}.`,
            },
          };
        }
        return {
          ok: false,
          toast: {
            title: "Move blocked",
            description: `${who.name} can't play ${pos} in strict mode.`,
            variant: "destructive",
          },
        };
      };

      const va = validate(a, b.position);
      const vb = validate(b, a.position);
      if (va.toast) toast(va.toast);
      if (vb.toast) toast(vb.toast);
      if (!va.ok || !vb.ok) return;

      let logEntry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time"> | null = null;
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

      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === a.id) return { ...p, position: b.position };
          if (p.id === b.id) return { ...p, position: a.position };
          return p;
        })
      );
      if (logEntry) appendSubLog(logEntry);
    },
    [players, validationMode, toast, appendSubLog]
  );

  const selectedPlayer = useMemo(
    () => (selectedPlayerId ? players.find((p) => p.id === selectedPlayerId) ?? null : null),
    [selectedPlayerId, players]
  );

  // TAP = start a sub directly. Long-press opens the quick action sheet.
  // This mirrors the soccer pitch board: one tap to "pick up" a player, a
  // second tap on a target completes the swap. Avoids the previous extra
  // sheet step that confused new users.
  const subConfirm = useSubConfirm();

  const handlePlayerClick = useCallback(
    (playerId: string) => {
      if (readOnly) return;
      // Sub-mode active → second tap stages a confirmation before swapping.
      if (selectedPlayerId) {
        if (selectedPlayerId === playerId) {
          setSelectedPlayerId(null);
          return;
        }
        const a = players.find((p) => p.id === selectedPlayerId);
        const b = players.find((p) => p.id === playerId);
        if (!a || !b) return;
        const aOnBench = a.position === null;
        const bOnBench = b.position === null;
        // Build a human-readable payload describing exactly what's about to happen.
        const payload =
          aOnBench || bOnBench
            ? {
                kind: "sub-on" as const,
                primaryName: aOnBench ? a.name : b.name,
                secondaryName: aOnBench ? b.name : a.name,
                position: (aOnBench ? b.position : a.position) ?? undefined,
              }
            : {
                kind: "swap-court" as const,
                primaryName: a.name,
                secondaryName: b.name,
              };
        subConfirm.request(payload, () => {
          performSwap(selectedPlayerId, playerId);
          setSelectedPlayerId(null);
        });
        return;
      }
      // No player armed yet:
      //  - Sub Mode ON  → arm this player as the swap source (legacy fast flow).
      //  - Sub Mode OFF → open the info card. The card's primary "Sub" CTA
      //    will arm this player + flip Sub Mode on so the next tap completes
      //    the swap (matches Pitch Board pattern).
      if (subModeActive) {
        setSelectedPlayerId(playerId);
        hapticSelectionTick();
      } else {
        setInfoCardPlayerId(playerId);
        hapticSelectionTick();
      }
    },
    [selectedPlayerId, performSwap, readOnly, players, subConfirm, subModeActive],
  );

  const handlePlayerLongPress = useCallback(
    (playerId: string) => {
      if (readOnly) return;
      // Long-press always opens the action sheet (score, mark injured, etc.)
      // — clear any in-progress swap first so the user isn't fighting state.
      setSelectedPlayerId(null);
      setQuickActionPlayerId(playerId);
    },
    [readOnly]
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
      // Build the actual mutation as a deferred closure so the confirm
      // dialog can fire it on user approval.
      const commit = () => {
        let logEntry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time"> | null = null;
        setPlayers((prev) => {
          const incoming = prev.find((p) => p.id === selectedPlayerId);
          if (!incoming) return prev;
          const displaced = prev.find((p) => p.position === position && p.id !== incoming.id);
          // Only log a sub when the incoming was on the bench AND a real player
          // was displaced. Empty-slot fills aren't subs (no playerOut) — logging
          // them with playerOutId="" would orphan the entry and break undo.
          if (incoming.position === null && displaced) {
            logEntry = {
              playerOutId: displaced.id,
              playerOutName: displaced.name,
              playerInId: incoming.id,
              playerInName: incoming.name,
              position,
              source: "manual",
            };
          }
          return prev.map((p) => {
            if (p.id === incoming.id) return transitionPosition(p, position);
            // CRITICAL: bench the displaced player. Without this both players
            // would hold the same position simultaneously (data corruption).
            if (p.id === displaced?.id) return transitionPosition(p, null);
            return p;
          });
        });
        if (logEntry) appendSubLog(logEntry);
        setSelectedPlayerId(null);
      };

      const displaced = players.find(
        (p) => p.position === position && p.id !== selectedPlayerId,
      );
      const incomingFromBench = incoming && incoming.position === null;
      if (incomingFromBench && displaced) {
        // Bench → court substitution (replacing a player).
        subConfirm.request(
          {
            kind: "sub-on",
            primaryName: incoming.name,
            secondaryName: displaced.name,
            position,
          },
          commit,
        );
      } else if (incoming && incoming.position !== null && displaced) {
        // Court → court swap into an occupied slot.
        subConfirm.request(
          {
            kind: "swap-court",
            primaryName: incoming.name,
            secondaryName: displaced.name,
            position,
          },
          commit,
        );
      } else if (incomingFromBench && !displaced) {
        // Bench → empty slot (still a sub-on, just no displacement).
        subConfirm.request(
          { kind: "sub-on", primaryName: incoming!.name, position },
          commit,
        );
      } else {
        // Court → empty slot — same player, just repositioning. No confirm needed.
        commit();
      }
    },
    [readOnly, selectedPlayerId, appendSubLog, players, validationMode, toast, subConfirm]
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

  /**
   * Direct drag-and-drop assignment used by the pre-game lineup picker.
   * Mirrors basketball's assignToPosition semantics with netball validation.
   */
  const assignToPosition = useCallback(
    (playerId: string, position: NetballPosition | null) => {
      if (readOnly) return;
      // Validate up-front (avoid toasts inside setPlayers — audit fix N9).
      if (position) {
        const incoming = players.find((p) => p.id === playerId);
        if (incoming && validationMode !== "free") {
          const allowed = isPositionAllowedForPlayer(incoming, position);
          if (!allowed) {
            if (validationMode === "strict") {
              toast({
                title: "Move blocked",
                description: `${incoming.name} can't play ${position} in strict mode.`,
                variant: "destructive",
              });
              return;
            }
            toast({
              title: "Position warning",
              description: `${incoming.name} isn't a preferred ${position}.`,
            });
          }
        }
      }
      let logEntry: Omit<NetballSubLogEntry, "id" | "at" | "quarter" | "time"> | null = null;
      setPlayers((prev) => {
        const incoming = prev.find((p) => p.id === playerId);
        if (!incoming) return prev;
        if (incoming.position === position) return prev;
        if (position === null) {
          return prev.map((p) =>
            p.id === incoming.id ? transitionPosition(p, null) : p
          );
        }
        const displaced = prev.find((p) => p.position === position && p.id !== incoming.id);
        if (incoming.position === null && displaced) {
          logEntry = {
            playerOutId: displaced.id,
            playerOutName: displaced.name,
            playerInId: incoming.id,
            playerInName: incoming.name,
            position,
            source: "manual",
          };
        }
        return prev.map((p) => {
          if (p.id === incoming.id) return transitionPosition(p, position);
          if (p.position === position && p.id !== incoming.id) {
            return transitionPosition(p, incoming.position);
          }
          return p;
        });
      });
      if (logEntry) appendSubLog(logEntry);
    },
    [readOnly, players, validationMode, toast, appendSubLog]
  );

  // ---------- Pending quarter-break dialog handlers ----------
  const confirmPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    const subs = pendingQuarterSubs.subs;
    const subKeys = new Set(subs.map(getSubKey));
    setPlayers((prev) => {
      let next = prev;
      for (const sub of subs) {
        const out = next.find((p) => p.id === sub.playerOut.id);
        const inP = next.find((p) => p.id === sub.playerIn.id);
        if (!out?.position || !inP || inP.position !== null) continue;
        next = next.map((p) => {
          if (p.id === out.id) return transitionPosition(p, null);
          if (p.id === inP.id) return transitionPosition(p, sub.position);
          return p;
        });
      }
      return next;
    });
    setAutoSubPlan((prev) =>
      prev.map((s) => (subKeys.has(getSubKey(s)) ? { ...s, executed: true } : s))
    );
    subs.forEach((sub) =>
      appendSubLog({
        playerOutId: sub.playerOut.id,
        playerOutName: sub.playerOut.name,
        playerInId: sub.playerIn.id,
        playerInName: sub.playerIn.name,
        position: sub.position,
        source: "auto",
      })
    );
    // Notify admins/coaches for every sub in the batch.
    const periodType = timerStateRef.current.periodType;
    const q = pendingQuarterSubs.quarter;
    const periodLabel =
      periodType === "halves" ? `H${q <= 2 ? 1 : 2}` : `Q${q}`;
    subs.forEach((sub) =>
      void notifyAutoSub({
        playerInName: sub.playerIn.name,
        playerOutName: sub.playerOut.name,
        position: sub.position,
        periodLabel,
      })
    );
    setPendingQuarterSubs(null);
  }, [pendingQuarterSubs, appendSubLog, notifyAutoSub]);

  const skipPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    const skippedKeys = new Set(pendingQuarterSubs.subs.map(getSubKey));
    setAutoSubPlan((prev) =>
      prev.map((s) => (skippedKeys.has(getSubKey(s)) ? { ...s, skipped: true } : s))
    );
    setPendingQuarterSubs(null);
    toast({ title: "Subs skipped", description: `Q${pendingQuarterSubs.quarter} rotation cleared.` });
  }, [pendingQuarterSubs, toast]);


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
      // be credited if the side that took it scored first. Only seed when we
      // actually know which side took it (audit fix N13) — defaulting to
      // "home" silently mis-credited possession when the toss wasn't set.
      if (cpLog.length === 0 && s.centrePass) {
        cpLog.push({
          id: crypto.randomUUID(),
          quarter: s.currentQuarter,
          side: s.centrePass,
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
    // Capture the last event BEFORE entering the state updater so we can
    // safely roll back per-player goals OUTSIDE setTimerState. Calling
    // setPlayers from inside a setTimerState updater double-fires under
    // StrictMode and decrements goals by 2× (audit fix N18).
    let attributedHomeGoal: { playerId: string; points: number } | null = null;
    setTimerState((s) => {
      const log = s.scoreLog ?? [];
      if (log.length === 0) return s;
      const last = log[log.length - 1];
      if (last.side === "home" && last.playerId) {
        attributedHomeGoal = { playerId: last.playerId, points: last.points };
      }
      // Roll back the centre-pass log too: drop the auto-pushed "next" CP and
      // unconvert the previous CP we credited. CRITICAL: stop walking at the
      // quarter boundary (audit fix N8) — otherwise an undo could un-credit
      // a goal scored in a previous quarter and corrupt historical CP stats.
      const cpLog = [...(s.centrePassLog ?? [])];
      if (cpLog.length > 0 && !cpLog[cpLog.length - 1].converted) {
        cpLog.pop();
      }
      for (let i = cpLog.length - 1; i >= 0; i--) {
        if (cpLog[i].quarter !== last.quarter) break;
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
    if (attributedHomeGoal) {
      const { playerId, points } = attributedHomeGoal;
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? { ...p, goals: Math.max(0, (p.goals ?? 0) - points) }
            : p
        )
      );
    }
  }, []);

  const setCentrePass = useCallback(
    (side: "home" | "away" | ((prev: "home" | "away") => "home" | "away")) => {
      setTimerState((s) => ({
        ...s,
        // Functional form so rapid swap taps don't read a stale `s.centrePass`
        // (audit fix N16). Existing callers passing a literal still work.
        centrePass:
          typeof side === "function" ? side(s.centrePass ?? "home") : side,
        lastUpdateTime: Date.now(),
      }));
    },
    []
  );

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
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 2, timerState.periodType ?? "quarters", timerState.minutesPerQuarter));
    }
    // Plan changed → coach must review again before kickoff.
    setHasReviewedAutoSubs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType, rosterSignature]);

  // ---------- Auto-sub control panel handlers ----------
  // Scoped to the CURRENT quarter only (audit fix N-equivalent of B8) — keep
  // manual controls consistent with `findNextDueSub`. Pulling forward a Q3
  // sub during Q1 yanks a starter and breaks the coach's mental model.
  const findUpcomingSub = useCallback(() => {
    return autoSubPlan.find(
      (s) =>
        !s.executed &&
        !s.skipped &&
        s.quarter === timerState.currentQuarter
    );
  }, [autoSubPlan, timerState.currentQuarter]);

  const executeNextSubNow = useCallback(() => {
    const target = findUpcomingSub();
    if (!target) {
      toast({ title: "No subs queued this period" });
      return;
    }
    executeSub(target);
  }, [findUpcomingSub, executeSub, toast]);

  const skipNextSub = useCallback(() => {
    const target = findUpcomingSub();
    if (!target) {
      toast({ title: "No subs queued this period" });
      return;
    }
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
        : generateQuarterBreakRotationPlan(players, 2, timerState.periodType ?? "quarters", timerState.minutesPerQuarter);
    // Preserve BOTH executed AND skipped history so a regen never resurrects
    // a sub the coach already actioned (audit fix N7).
    const history = autoSubPlan.filter((s) => s.executed || s.skipped);
    const historyKeys = new Set(history.map(getSubKey));
    // Drop fresh subs whose playerOut is no longer on court — otherwise a
    // manual swap that benched the planned playerOut would queue an invalid
    // "sub-off" for an already-benched player (audit fix B14/N15).
    const onCourtIds = new Set(players.filter((p) => p.position !== null).map((p) => p.id));
    setAutoSubPlan([
      ...history,
      ...fresh.filter(
        (f) => !historyKeys.has(getSubKey(f)) && onCourtIds.has(f.playerOut.id)
      ),
    ]);
    toast({ title: "Plan regenerated" });
  }, [rotationMode, players, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType, autoSubPlan, toast]);

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

  const infoCardPlayer = useMemo(
    () => players.find((p) => p.id === infoCardPlayerId) ?? null,
    [players, infoCardPlayerId],
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
    // The button is labelled "Q{next}→" so it should plan/apply the NEXT
    // quarter, not re-apply the current one.
    const periods = visiblePeriods(timerState.periodType);
    const idx = periods.indexOf(timerState.currentQuarter);
    const nextQ = (periods[idx + 1] ?? null) as Quarter | null;
    if (!nextQ) {
      toast({ title: "No more quarters", description: "You're already in the final period." });
      return;
    }
    const label = periodLabel(nextQ, timerState.periodType);
    const lineup = quarterLineups.find((l) => l.quarter === nextQ);
    if (!lineup || Object.keys(lineup.assignments).length === 0) {
      // No plan yet — open the planner so the coach can build one
      // instead of dropping a toast they have to chase.
      setLineupPlannerOpen(true);
      toast({
        title: `No ${label} lineup yet`,
        description: "Plan it now and we'll apply it at the break.",
      });
      return;
    }
    setPlayers((prev) => applyLineup(prev, lineup));
    toast({ title: `${label} lineup applied` });
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

  // ---------- Render — three-zone shell mirroring BasketballBoard ----------
  const selectedIsOnCourt = !!selectedPlayer && selectedPlayer.position !== null;
  const selectedIsOnBench = !!selectedPlayer && selectedPlayer.position === null;
  const opponentName = timerState.opponentName ?? "Opponent";
  const hasGameStarted =
    timerState.isRunning ||
    timerState.currentQuarter > 1 ||
    timerState.elapsedSeconds > 0 ||
    (timerState.scoreLog?.length ?? 0) > 0 ||
    !!timerState.isGameFinished;
  const isPreGame = !hasGameStarted;
  const gameInProgress = hasGameStarted && !timerState.isGameFinished;

  // ── PRE-GAME ─────────────────────────────────────────────────────
  // Drag-first squad/lineup screen — mirror of basketball. No live HUD,
  // no scoreboard, no centre-pass chip leaking until tip-off.
  if (isPreGame) {
    return (
      <>
        <NetballPreGameScreen
          teamName={teamName}
          opponentName={opponentName}
          players={players}
          bench={bench}
          onAssign={assignToPosition}
          minutesPerQuarter={timerState.minutesPerQuarter}
          periodType={timerState.periodType ?? "quarters"}
          rotationMode={rotationMode}
          rotationIntervalMinutes={rotationIntervalMinutes}
          onToggleAutoSub={(next) => {
            setRotationMode(next);
            persistDefaults({ court_rotation_mode: next });
          }}
          onRotationIntervalChange={(n) => {
            setRotationIntervalMinutes(n);
            persistDefaults({ court_rotation_interval_minutes: n });
          }}
          onPreviewPlan={() => {
            setHasReviewedAutoSubs(true);
            setAutoSubPanelPreview(true);
            setAutoSubPanelOpen(true);
          }}
          hasAutoSubPlan={autoSubPlan.some((s) => !s.executed && !s.skipped)}
          autoSubPlan={autoSubPlan}
          validationMode={validationMode}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSquad={() => setRosterOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          hasPresets={lineupPresets.length > 0}
          onStartGame={() => {
            const hasPending = autoSubPlan.some((s) => !s.executed && !s.skipped);
            if (rotationMode !== "off" && hasPending && !hasReviewedAutoSubs) {
              setKickoffConfirmOpen(true);
              return;
            }
            setTimerState((s) => ({
              ...s,
              isRunning: true,
              lastUpdateTime: Date.now(),
            }));
          }}
          onBack={onClose}
          readOnly={readOnly}
        />

        <Suspense fallback={<DialogLoader />}>
          {settingsOpen && (
            <NetballGameSettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              periodType={timerState.periodType ?? "quarters"}
              onPeriodTypeChange={(p) => {
                setPeriodType(p);
                persistDefaults({ court_period_type: p });
              }}
              minutesPerQuarter={timerState.minutesPerQuarter}
              onMinutesPerQuarterChange={(n) => {
                setTimerState((s) => ({
                  ...s,
                  minutesPerQuarter: n,
                  lastUpdateTime: Date.now(),
                }));
                persistDefaults({ court_minutes_per_quarter: n });
              }}
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
          {lineupPlannerOpen && (
            <QuarterLineupPlanner
              open={lineupPlannerOpen}
              onOpenChange={setLineupPlannerOpen}
              players={players}
              lineups={quarterLineups}
              onSave={setQuarterLineups}
            />
          )}
          {autoSubPanelOpen && (
            <QuarterAutoSubControlPanel
              open={autoSubPanelOpen}
              onClose={() => {
                setAutoSubPanelOpen(false);
                setAutoSubPanelPreview(false);
              }}
              autoSubPlan={autoSubPlan}
              onPlayers={onCourtForPanel}
              currentQuarter={timerState.currentQuarter}
              currentElapsedSeconds={timerState.elapsedSeconds}
              minutesPerQuarter={timerState.minutesPerQuarter}
              periodType={timerState.periodType}
              autoSubPaused={autoSubPaused}
              lockedPlayerIds={lockedPlayerIds}
              onTogglePause={toggleAutoSubPaused}
              onExecuteNow={executeNextSubNow}
              onSkipNext={skipNextSub}
              onCancelPlan={cancelAutoSubPlan}
              onRegeneratePlan={regenerateAutoSubPlan}
              onToggleLockPlayer={toggleLockPlayer}
              onEditPlan={() => setLineupPlannerOpen(true)}
              previewMode={autoSubPanelPreview}
            />
          )}
        </Suspense>

        <NetballKickoffConfirm
          open={kickoffConfirmOpen}
          onOpenChange={setKickoffConfirmOpen}
          rotationIntervalMinutes={rotationIntervalMinutes}
          plannedSubsCount={
            autoSubPlan.filter((s) => !s.executed && !s.skipped).length
          }
          onPreview={() => {
            setHasReviewedAutoSubs(true);
            setAutoSubPanelPreview(true);
            setAutoSubPanelOpen(true);
          }}
          onConfirm={() => {
            setKickoffConfirmOpen(false);
            setHasReviewedAutoSubs(true);
            setTimerState((s) => ({
              ...s,
              isRunning: true,
              lastUpdateTime: Date.now(),
            }));
          }}
        />
      </>
    );
  }

  // Final period flag drives the "Next break" disabled state in the live action bar.
  const _periods = visiblePeriods(timerState.periodType);
  const isFinalPeriod =
    _periods.indexOf(timerState.currentQuarter) === _periods.length - 1;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── COURT — full-bleed primary surface with floating HUD overlay ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Tap-outside-to-cancel scrim while a player is selected. */}
        {selectedPlayer && (
          <button
            type="button"
            aria-label="Cancel substitution"
            onClick={() => setSelectedPlayerId(null)}
            className="absolute inset-0 z-10 cursor-default bg-transparent"
          />
        )}

        {selectedPlayer ? (
          <SubModeBanner
            selectedPlayer={selectedPlayer}
            onCancel={() => setSelectedPlayerId(null)}
          />
        ) : (
          <>
            {/* ── COMPACT LIVE HUD — pinned top bar with timer + score ── */}
            <NetballLiveHUD
              homeLabel={teamName}
              awayLabel={opponentName}
              homeScore={timerState.homeScore ?? 0}
              awayScore={timerState.awayScore ?? 0}
              readOnly={readOnly}
              disabled={!gameInProgress || !!timerState.isGameFinished}
              suppressed={!!selectedPlayerId}
              onScore={(side) => {
                // Tap = +1 instantly. Home goals open scorer sheet for
                // attribution; away goals fire raw +1 (no roster to attribute).
                if (side === "home") {
                  setScorerSide("home");
                  setGoalScorerOpen(true);
                } else {
                  addScore(side, 1);
                }
              }}
              onScoreLongPress={(side) => {
                // Long-press = always open the scorer sheet for that side so
                // the coach can attribute / undo / pick a different scorer.
                setScorerSide(side);
                setGoalScorerOpen(true);
              }}
              onBack={onClose}
              controlSlot={
                <NetballQuarterTimer
                  state={timerState}
                  onChange={setTimerState}
                  onTick={handleTick}
                  onQuarterEnd={handleQuarterEnd}
                  onReset={resetPlayerStats}
                  readOnly={readOnly}
                  compact
                  onOpenAutoSubPlan={
                    !readOnly && rotationMode !== "off"
                      ? () => setAutoSubPanelOpen(true)
                      : undefined
                  }
                  hasAutoSubPlan={autoSubPlan.length > 0}
                />
              }
              trailingSlot={<SyncStatusIndicator />}
              position={hudPosition}
              onTogglePosition={toggleHudPosition}
            />

          </>
        )}

        <NetballCourtArea
          players={players}
          selectedPlayerId={selectedPlayerId}
          selectedIsOnBench={selectedIsOnBench}
          nextSubOutId={nextSub?.playerOut.id ?? null}
          readOnly={readOnly}
          hideEmptySlots
          onPlayerClick={handlePlayerClick}
          onPlayerLongPress={handlePlayerLongPress}
          onSlotClick={handleSlotClick}
          onDragSwap={(srcId, tgtId) => {
            // Drag-drop = same confirm flow as tap-tap. Reuse handlePlayerClick
            // by simulating a select then a target tap so the SubConfirmDialog
            // surfaces, matching project memory ("every sub & swap confirms").
            setSelectedPlayerId(srcId);
            // Defer one tick so React applies the selection before the second tap.
            setTimeout(() => handlePlayerClick(tgtId), 0);
          }}
          onDragToSlot={(srcId, position) => {
            setSelectedPlayerId(srcId);
            setTimeout(() => handleSlotClick(position), 0);
          }}
        />
      </div>

      {/* ── BENCH — compressed live substitute tray ── */}
      <NetballBench
        bench={bench}
        selectedPlayerId={selectedPlayerId}
        selectedIsOnCourt={selectedIsOnCourt}
        nextSubInId={nextSub?.playerIn.id ?? null}
        readOnly={readOnly}
        onPlayerClick={handlePlayerClick}
        onPlayerLongPress={handlePlayerLongPress}
        onDragSwap={(srcId, tgtId) => {
          setSelectedPlayerId(srcId);
          setTimeout(() => handlePlayerClick(tgtId), 0);
        }}
      />

      {/* ── LIVE ACTION BAR — sub / auto-subs / next break, with setup actions in overflow ── */}
      {!readOnly && (
        <NetballLiveActionBar
          onToggleSubMode={() => {
            // Toggle persistent Sub Mode. When turning OFF, also clear any
            // armed selection so the board returns to its calm default.
            setSubModeActive((prev) => {
              const next = !prev;
              if (!next) setSelectedPlayerId(null);
              hapticSelectionTick();
              return next;
            });
          }}
          subModeActive={subModeActive}
          onNextBreak={applyNextLineupNow}
          onOpenAutoSubs={() => setAutoSubPanelOpen(true)}
          onUndo={
            (timerState.scoreLog?.length ?? 0) > 0 ? undoScore : undoLastSub
          }
          canUndo={canUndoSub || (timerState.scoreLog?.length ?? 0) > 0}
          onOpenSummary={() => setSummaryOpen(true)}
          onOpenSquad={() => setRosterOpen(true)}
          onOpenLineups={() => setLineupPlannerOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          currentQuarter={timerState.currentQuarter}
          rotationMode={rotationMode}
          rotationIntervalMinutes={rotationIntervalMinutes}
          autoSubPaused={autoSubPaused}
          onToggleAutoSubPause={toggleAutoSubPaused}
          isFinalPeriod={isFinalPeriod}
        />
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
            onSubOff={() =>
              subConfirm.request(
                {
                  kind: "sub-off",
                  primaryName: quickActionPlayer.name,
                  position: quickActionPlayer.position ?? undefined,
                },
                () => subOff(quickActionPlayer.id),
              )
            }
            onSubOn={() => setSelectedPlayerId(quickActionPlayer.id)}
            onToggleInjured={() => toggleInjured(quickActionPlayer.id)}
            onScore={() => addScore("home", 1, quickActionPlayer.id)}
          />
        )}
        {goalScorerOpen && (
          <NetballGoalScorerSheet
            open={goalScorerOpen}
            onOpenChange={setGoalScorerOpen}
            candidates={
              scorerSide === "home"
                ? players.filter((p) => p.position === "GS" || p.position === "GA")
                : []
            }
            onAttribute={(playerId) => addScore(scorerSide, 1, playerId)}
            onSkip={() => addScore(scorerSide, 1)}
          />
        )}
        {infoCardPlayerId && infoCardPlayer && (
          <NetballPlayerCard
            open={!!infoCardPlayerId}
            onOpenChange={(o) => !o && setInfoCardPlayerId(null)}
            player={infoCardPlayer}
            onStartSub={() => {
              // Arm this player + flip Sub Mode on. Coach's next tap completes the swap.
              setSelectedPlayerId(infoCardPlayer.id);
              setSubModeActive(true);
            }}
            onSubOff={() => subOff(infoCardPlayer.id)}
            onToggleInjured={() => toggleInjured(infoCardPlayer.id)}
            onScore={
              infoCardPlayer.position === "GS" || infoCardPlayer.position === "GA"
                ? () => addScore("home", 1, infoCardPlayer.id)
                : undefined
            }
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

      <NetballQuarterBreakDialog
        open={!!pendingQuarterSubs}
        quarter={pendingQuarterSubs?.quarter ?? null}
        subs={pendingQuarterSubs?.subs ?? []}
        onConfirm={confirmPendingQuarterSubs}
        onSkip={skipPendingQuarterSubs}
      />

      <SubConfirmDialog
        payload={subConfirm.pending?.payload ?? null}
        onConfirm={subConfirm.confirm}
        onCancel={subConfirm.cancel}
      />

      {/* Auto-sub confirmation — fires when the engine queues a planned
          mid-quarter sub. Quarter-break batches use NetballQuarterBreakDialog. */}
      <SubConfirmDialog
        payload={
          pendingAutoSub
            ? {
                kind: "sub-on",
                primaryName: pendingAutoSub.playerIn.name,
                secondaryName: pendingAutoSub.playerOut.name,
                position: pendingAutoSub.position,
              }
            : null
        }
        onConfirm={confirmPendingAutoSub}
        onCancel={cancelPendingAutoSub}
      />

    </div>
  );
}
