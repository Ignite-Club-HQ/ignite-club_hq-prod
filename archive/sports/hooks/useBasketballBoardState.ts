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
  SubLogEntry,
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
  getSubKey,
  pickLikeForLikeBenchPlayer,
  safeLoad,
  safeSave,
  transitionPosition,
} from "@/components/basketball/basketballHelpers";
import { useBasketballGameSync } from "@/hooks/useBasketballGameSync";
import { useAutoSubNotify } from "@/hooks/useAutoSubNotify";
import { cueQuarterEnd, cueSubDue, cueTimeout } from "@/lib/gameCues";
import { hapticImpactLight, hapticImpactMedium, hapticSelectionTick } from "@/lib/haptics";
import { visiblePeriods, periodLabel } from "@/lib/periodTypes";
import { trimLog, SUB_LOG_MAX, SCORE_LOG_MAX } from "@/lib/gameLogLimits";

interface Member {
  id: string;
  user_id: string;
  role: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

interface UseBasketballBoardStateArgs {
  teamId: string;
  teamName: string;
  members: Member[];
  readOnly: boolean;
  initialMinutesPerQuarter: number;
  /** When provided, board state is scoped per-event so multiple matches
   *  on the same team don't share/overwrite state. */
  eventId?: string | null;
}

/**
 * Encapsulates ALL state, persistence, sync, and game-logic handlers for the
 * basketball board. Keeps the BasketballBoard component focused on layout.
 */
export function useBasketballBoardState({
  teamId,
  teamName,
  members,
  readOnly,
  initialMinutesPerQuarter,
  eventId = null,
}: UseBasketballBoardStateArgs) {
  const { toast } = useToast();
  const stateKey = getBasketballStateKey(teamId, eventId);
  const timerKey = getBasketballTimerKey(teamId, eventId);

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
    // ROSTER SEEDING: strictly player-role only. Children assigned to the
    // team are passed in as role:"player" by the parent, so they appear here
    // too. Parents, coaches, and admins are NOT part of the squad.
    const playersOnly = members.filter((m) => m.role === "player");
    return playersOnly.slice(0, 12).map((m, idx) => {
      const position = idx < 5 ? BASKETBALL_POSITIONS[idx] : null;
      return {
        id: m.id,
        name: m.profiles?.display_name?.trim() || `Player ${idx + 1}`,
        position,
        minutesPlayed: 0,
        fouls: 0,
        points: 0,
        preferredPositions: [],
      };
    });
  };

  // ---------- Core state ----------
  const [players, setPlayers] = useState<BasketballPlayer[]>(buildInitialPlayers);

  // Hydrate squad once members arrive (the parent fetch is async, so on first
  // mount `members` is often empty — without this effect the roster dialog
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
        timeoutsPerHalf: 3,
        homeTimeoutsRemaining: 3,
        awayTimeoutsRemaining: 3,
        timeoutsHalfTracked: 1,
        periodType: "quarters",
      }
  );
  // Mirror into a ref so callbacks can read the latest periodType / quarter
  // without taking it as a dep (avoids stale closures + needless re-binds).
  const timerStateRef = useRef(timerState);
  timerStateRef.current = timerState;

  // UI state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [quickActionPlayerId, setQuickActionPlayerId] = useState<string | null>(null);
  const [pendingQuarterSubs, setPendingQuarterSubs] = useState<{
    quarter: Quarter;
    subs: BasketballSubEvent[];
  } | null>(null);
  const [courtView, setCourtView] = useState<BasketballCourtView>("half");
  // Auto-sub control panel state — persisted across reloads via boardState.
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
  // For HOME baskets, an optional playerId attributes the points to that
  // player so the coach gets a per-player score breakdown.
  const addScore = useCallback(
    (side: "home" | "away", points: number, playerId?: string, scoreEventId?: string) => {
      // Tactile confirmation — coaches scoring on a noisy sideline can confirm
      // by feel without looking down. Light for 1pt, medium for 2-3.
      if (points >= 2) hapticImpactMedium();
      else hapticImpactLight();
      setTimerState((s) => {
        const event = {
          id: scoreEventId ?? crypto.randomUUID(),
          side,
          points,
          quarter: s.currentQuarter,
          at: Date.now(),
          playerId: side === "home" ? playerId : undefined,
        };
        return {
          ...s,
          homeScore: (s.homeScore ?? 0) + (side === "home" ? points : 0),
          awayScore: (s.awayScore ?? 0) + (side === "away" ? points : 0),
          scoreLog: trimLog([...(s.scoreLog ?? []), event], SCORE_LOG_MAX),
          lastUpdateTime: Date.now(),
        };
      });
      if (side === "home" && playerId) {
        setPlayers((prev) =>
          prev.map((p) => {
            if (p.id !== playerId) return p;
            const next = { ...p, points: (p.points ?? 0) + points };
            if (points === 1) next.pointsBy1 = (p.pointsBy1 ?? 0) + 1;
            else if (points === 2) next.pointsBy2 = (p.pointsBy2 ?? 0) + 1;
            else if (points === 3) next.pointsBy3 = (p.pointsBy3 ?? 0) + 1;
            return next;
          })
        );
      }
    },
    []
  );

  const attributeScore = useCallback((scoreEventId: string, playerId?: string) => {
    if (!scoreEventId || !playerId) return;

    let awardedPoints = 0;
    let previousPlayerId: string | undefined;
    setTimerState((s) => {
      const log = s.scoreLog ?? [];
      const target = log.find((event) => event.id === scoreEventId);
      if (!target || target.side !== "home") return s;
      if (target.playerId === playerId) return s;
      awardedPoints = target.points;
      previousPlayerId = target.playerId;
      return {
        ...s,
        scoreLog: log.map((event) =>
          event.id === scoreEventId ? { ...event, playerId } : event
        ),
        lastUpdateTime: Date.now(),
      };
    });

    if (awardedPoints <= 0) return;

    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== playerId && p.id !== previousPlayerId) return p;
        const delta = p.id === playerId ? awardedPoints : -awardedPoints;
        const next = { ...p, points: Math.max(0, (p.points ?? 0) + delta) };
        if (awardedPoints === 1) next.pointsBy1 = Math.max(0, (p.pointsBy1 ?? 0) + (p.id === playerId ? 1 : -1));
        else if (awardedPoints === 2) next.pointsBy2 = Math.max(0, (p.pointsBy2 ?? 0) + (p.id === playerId ? 1 : -1));
        else if (awardedPoints === 3) next.pointsBy3 = Math.max(0, (p.pointsBy3 ?? 0) + (p.id === playerId ? 1 : -1));
        return next;
      })
    );
  }, []);

  const undoScore = useCallback(() => {
    // Capture the attributed-points rollback target BEFORE entering the
    // setTimerState updater so we can call setPlayers cleanly afterwards.
    // Calling setPlayers from inside a setTimerState updater double-fires
    // under StrictMode and decrements points by 2× (audit fix B18).
    let attributed: { playerId: string; points: number } | null = null;
    setTimerState((s) => {
      const log = s.scoreLog ?? [];
      if (log.length === 0) return s;
      const last = log[log.length - 1];
      if (last.side === "home" && last.playerId) {
        attributed = { playerId: last.playerId, points: last.points };
      }
      return {
        ...s,
        homeScore: Math.max(0, (s.homeScore ?? 0) - (last.side === "home" ? last.points : 0)),
        awayScore: Math.max(0, (s.awayScore ?? 0) - (last.side === "away" ? last.points : 0)),
        scoreLog: log.slice(0, -1),
        lastUpdateTime: Date.now(),
      };
    });
    if (attributed) {
      const { playerId, points } = attributed;
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id !== playerId) return p;
          const next = { ...p, points: Math.max(0, (p.points ?? 0) - points) };
          if (points === 1) next.pointsBy1 = Math.max(0, (p.pointsBy1 ?? 0) - 1);
          else if (points === 2) next.pointsBy2 = Math.max(0, (p.pointsBy2 ?? 0) - 1);
          else if (points === 3) next.pointsBy3 = Math.max(0, (p.pointsBy3 ?? 0) - 1);
          return next;
        })
      );
    }
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
      autoSubPaused,
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

  // ---------- Persistence ----------
  useEffect(() => {
    safeSave(stateKey, boardState);
  }, [boardState, stateKey]);
  useEffect(() => {
    safeSave(timerKey, timerState);
  }, [timerState, timerKey]);
  useBasketballGameSync(boardState, timerState, !readOnly);

  // ---------- Sub execution ----------
  // Centralised sub log writer — every sub (auto or manual) flows through one
  // of the appendSubLog calls below so undo + summary stay accurate.
  const appendSubLog = useCallback(
    (entry: Omit<SubLogEntry, "id" | "at" | "quarter" | "time">) => {
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

  // Push notify all team admins/coaches when an auto-sub fires.
  const notifyAutoSub = useAutoSubNotify(teamId, teamName, eventId);
  // Pending mid-quarter auto-sub awaiting coach confirmation. Quarter-break
  // batches still flow through pendingQuarterSubs (separate dialog).
  const [pendingAutoSub, setPendingAutoSub] = useState<BasketballSubEvent | null>(null);
  const stagedAutoSubKeysRef = useRef<Set<string>>(new Set());

  const applyAutoSub = useCallback(
    (sub: BasketballSubEvent) => {
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
      // Match by stable key — `regenerateAutoSubPlan` rebuilds the plan
      // with new object identities, so `s === sub` would silently miss and
      // the sub would re-fire every tick (audit fix B1/N1).
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
      const periodType = timerStateRef.current.periodType;
      const q = timerStateRef.current.currentQuarter;
      const lbl = periodLabel(q, periodType);
      void notifyAutoSub({
        playerInName: sub.playerIn.name,
        playerOutName: sub.playerOut.name,
        position: sub.position,
        periodLabel: lbl,
      });
    },
    [toast, appendSubLog, notifyAutoSub]
  );

  // Stage instead of mutating immediately so a confirm dialog can surface.
  const executeSub = useCallback((sub: BasketballSubEvent) => {
    const key = getSubKey(sub);
    if (stagedAutoSubKeysRef.current.has(key)) return;
    stagedAutoSubKeysRef.current.add(key);
    setPendingAutoSub(sub);
  }, []);

  const confirmPendingAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    applyAutoSub(pendingAutoSub);
    setPendingAutoSub(null);
  }, [pendingAutoSub, applyAutoSub]);

  const cancelPendingAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    const skippedKey = getSubKey(pendingAutoSub);
    setAutoSubPlan((prev) =>
      prev.map((s) => (getSubKey(s) === skippedKey ? { ...s, skipped: true } : s))
    );
    setPendingAutoSub(null);
  }, [pendingAutoSub]);

  // ---------- Time tracking ----------
  // `delta` is the number of real seconds elapsed since the last tick — using
  // a hard-coded `1` causes drift after the app backgrounds (the timer keeps
  // ticking via wall-clock but per-player minutes wouldn't catch up).
  // Track which subs we've already "warned" about so we don't beep every second.
  const cuedSubIdsRef = useRef<Set<string>>(new Set());

  // ---------- Full reset (called from timer's reset button) ----------
  // Wipe per-player stats AND any cached cue/sub state so a fresh game starts
  // cleanly. Without this, stale "ghost" sub cues would re-fire and old
  // fouls/points/FTs would persist visually after a confirmed reset.
  const resetPlayerStats = useCallback(() => {
    cuedSubIdsRef.current = new Set();
    setAutoSubPlan((prev) => prev.map((s) => ({ ...s, executed: false, skipped: false })));
    setLockedPlayerIds(new Set());
    setAutoSubPaused(false);
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        minutesPlayed: 0,
        fouls: 0,
        points: 0,
        ftMade: 0,
        ftAttempted: 0,
        isFouledOut: false,
        isInjured: false,
        lastBenchedAt: null,
      }))
    );
  }, []);
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
      // B23 audit fix: when the timer credits the final partial second of a
      // quarter, `onQuarterEnd` is fired immediately afterwards and may apply
      // the next quarter's lineup. If we also fire an auto-sub here, the
      // lineup overwrites the swap but the sub-log entry remains, leaving
      // an orphaned record. Skip auto-sub firing on the quarter-end credit
      // tick — quarter-break rotations have their own path.
      const quarterSeconds = timerStateRef.current.minutesPerQuarter * 60;
      const isQuarterEndCredit = elapsed >= quarterSeconds;
      if (rotationMode !== "off" && !autoSubPaused && !isQuarterEndCredit) {
        // Cue the coach ~10s before a sub fires so they have time to react.
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
    [autoSubPlan, rotationMode, executeSub, autoSubPaused, lockedPlayerIds]
  );

  // ---------- Quarter end ----------
  const handleQuarterEnd = useCallback(
    (endedQuarter: Quarter) => {
      cueQuarterEnd();
      // In halves mode the visible periods are [1, 3], so "next" after slot 1
      // is slot 3 — NOT slot 2. Using +1 silently broke quarterLineups lookups
      // and quarter-break subs whenever a coach ran the game in halves mode.
      const periodType = timerStateRef.current.periodType;
      const periods = visiblePeriods(periodType);
      const idx = periods.indexOf(endedQuarter);
      const isFinalPeriod = idx === periods.length - 1;
      const nextQuarter = (periods[idx + 1] ?? null) as Quarter | null;

      // Reset half-based timeouts when crossing into the second half.
      // Quarters mode → Q3 is the start of H2. Halves mode → slot 3 ("H2") is the second half.
      if (nextQuarter === 3) {
        setTimerState((s) => ({
          ...s,
          homeTimeoutsRemaining: s.timeoutsPerHalf ?? 3,
          awayTimeoutsRemaining: s.timeoutsPerHalf ?? 3,
          timeoutsHalfTracked: 2,
          lastUpdateTime: Date.now(),
        }));
      }
      // Purge stale cue keys for the ended quarter so cuedSubIdsRef can't
      // grow unbounded across long sessions (audit fix L5).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoSubPlan, quarterLineups, rotationMode, toast]
  );

  const confirmPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    // Apply ALL subs in one atomic setPlayers pass — calling executeSub in a
    // forEach loop runs each through its own setPlayers updater, and earlier
    // subs displace players to the bench so later subs see "playerOut not on
    // court" or "playerIn not on bench" and silently skip (audit fix B22).
    const subs = pendingQuarterSubs.subs;
    const subKeys = new Set(subs.map(getSubKey));
    setPlayers((prev) => {
      let next = prev;
      // Reserve target positions per sub up-front so we can detect collisions.
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
    // Mark all of them executed in one pass and append a single batched log.
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
    // Notify all team admins/coaches once per sub in the batch.
    const lbl = periodLabel(pendingQuarterSubs.quarter, timerStateRef.current.periodType);
    subs.forEach((sub) =>
      void notifyAutoSub({
        playerInName: sub.playerIn.name,
        playerOutName: sub.playerOut.name,
        position: sub.position,
        periodLabel: lbl,
      })
    );
    setPendingQuarterSubs(null);
  }, [pendingQuarterSubs, appendSubLog, notifyAutoSub]);

  const skipPendingQuarterSubs = useCallback(() => {
    if (!pendingQuarterSubs) return;
    const skipped = new Set(pendingQuarterSubs.subs);
    setAutoSubPlan((prev) =>
      prev.map((s) => (skipped.has(s) ? { ...s, skipped: true } : s))
    );
    setPendingQuarterSubs(null);
    toast({ title: "Subs skipped", description: `${periodLabel(pendingQuarterSubs.quarter, timerStateRef.current.periodType)} rotation cleared.` });
  }, [pendingQuarterSubs, toast]);

  // ---------- Recently-swapped highlight ----------
  // Brief glow on the two tokens involved in the most recent swap, so the
  // coach's eye tracks the change. Cleared after ~700ms.
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
  useEffect(() => {
    return () => {
      if (recentClearTimerRef.current != null) {
        window.clearTimeout(recentClearTimerRef.current);
      }
    };
  }, []);

  // ---------- Manual swap ----------
  const performSwap = useCallback(
    (aId: string, bId: string) => {
      hapticImpactMedium();
      let logEntry: {
        playerOutId: string;
        playerOutName: string;
        playerInId: string;
        playerInName: string;
        position: BasketballPosition;
      } | null = null;
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
        // Bench → court swap: log it as a sub so undo + summary stay accurate.
        // (Court → court swaps are positional re-shuffles, not subs — skip.)
        if (a.position === null && b.position !== null) {
          logEntry = {
            playerOutId: b.id,
            playerOutName: b.name,
            playerInId: a.id,
            playerInName: a.name,
            position: b.position,
          };
        } else if (b.position === null && a.position !== null) {
          logEntry = {
            playerOutId: a.id,
            playerOutName: a.name,
            playerInId: b.id,
            playerInName: b.name,
            position: a.position,
          };
        }
        return prev.map((p) => {
          if (p.id === a.id) return transitionPosition(p, b.position);
          if (p.id === b.id) return transitionPosition(p, a.position);
          return p;
        });
      });
      flashRecentSwap([aId, bId]);
      if (logEntry) appendSubLog({ ...logEntry, source: "manual" });
    },
    [validationMode, toast, appendSubLog, flashRecentSwap]
  );

  /**
   * Tap-first sub flow (matches the live-gameplay UX spec):
   *   1. First tap on ANY player (bench or court) selects them.
   *   2. Second tap on another player swaps them — instantly, no dialog.
   *   3. Tap the same player again to deselect.
   *
   * Quick actions (score, foul, injury) live behind a long-press to keep the
   * primary tap surface fast and unambiguous.
   */
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
      hapticSelectionTick();
      setSelectedPlayerId(playerId);
    },
    [selectedPlayerId, performSwap, readOnly]
  );

  /** Long-press → quick action sheet (score, foul, injury, manual swap…). */
  const handlePlayerLongPress = useCallback(
    (playerId: string) => {
      if (readOnly) return;
      // If we're mid-sub-mode, drop it so the sheet's actions aren't ambiguous.
      if (selectedPlayerId) setSelectedPlayerId(null);
      setQuickActionPlayerId(playerId);
    },
    [readOnly, selectedPlayerId]
  );

  const handleSlotClick = useCallback(
    (position: BasketballPosition) => {
      if (readOnly || !selectedPlayerId) return;
      let logEntry: {
        playerOutId: string;
        playerOutName: string;
        playerInId: string;
        playerInName: string;
        position: BasketballPosition;
      } | null = null;
      setPlayers((prev) => {
        const incoming = prev.find((p) => p.id === selectedPlayerId);
        if (!incoming) return prev;
        const displaced = prev.find((p) => p.position === position && p.id !== incoming.id);
        // Only treat it as a sub when the incoming player was on the bench.
        if (incoming.position === null && displaced) {
          logEntry = {
            playerOutId: displaced.id,
            playerOutName: displaced.name,
            playerInId: incoming.id,
            playerInName: incoming.name,
            position,
          };
        }
        return prev.map((p) => {
          if (p.id === incoming.id) return transitionPosition(p, position);
          if (p.position === position && p.id !== incoming.id) return transitionPosition(p, null);
          return p;
        });
      });
      if (logEntry) {
        appendSubLog({ ...logEntry, source: "manual" });
        flashRecentSwap([logEntry.playerInId, logEntry.playerOutId]);
      } else {
        flashRecentSwap([selectedPlayerId]);
      }
      setSelectedPlayerId(null);
    },
    [readOnly, selectedPlayerId, appendSubLog, flashRecentSwap]
  );

  /**
   * Direct drag-and-drop assignment. Moves `playerId` to `position` (or to bench
   * if `position` is null). If a different player already occupies that slot,
   * they are pushed to the bench (sub) — same semantics as handleSlotClick but
   * without needing the two-step select-then-tap flow.
   */
  const assignToPosition = useCallback(
    (playerId: string, position: BasketballPosition | null) => {
      if (readOnly) return;
      let logEntry: {
        playerOutId: string;
        playerOutName: string;
        playerInId: string;
        playerInName: string;
        position: BasketballPosition;
      } | null = null;
      setPlayers((prev) => {
        const incoming = prev.find((p) => p.id === playerId);
        if (!incoming) return prev;
        if (incoming.position === position) return prev;
        if (position === null) {
          // Drag off court → bench
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
          };
        }
        return prev.map((p) => {
          if (p.id === incoming.id) return transitionPosition(p, position);
          if (p.position === position && p.id !== incoming.id) {
            // If incoming was already on court, swap. Otherwise displaced → bench.
            return transitionPosition(p, incoming.position);
          }
          return p;
        });
      });
      if (logEntry) appendSubLog({ ...logEntry, source: "manual" });
      setSelectedPlayerId(null);
    },
    [readOnly, appendSubLog]
  );

  const subOff = useCallback(
    (playerId: string) => {
      let outName: string | null = null;
      let outPos: BasketballPosition | null = null;
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

  const addFoul = useCallback(
    (playerId: string) => {
      let newCount = 0;
      let playerName = "";
      let wasOnCourt = false;
      let backfillSub: {
        playerOutId: string;
        playerOutName: string;
        playerInId: string;
        playerInName: string;
        position: BasketballPosition;
      } | null = null;
      setPlayers((prev) => {
        const target = prev.find((p) => p.id === playerId);
        if (!target) return prev;
        newCount = Math.min(6, (target.fouls ?? 0) + 1);
        playerName = target.name;
        wasOnCourt = target.position !== null;
        const fouledOut = newCount >= 5;
        // B25 audit fix: when a player fouls out from the court, backfill
        // the vacated position from the bench (like-for-like) and append
        // a sub-log entry — otherwise the team plays 4-on-5 silently.
        let replacement: BasketballPlayer | undefined;
        if (fouledOut && wasOnCourt && target.position) {
          const benchPool = prev.filter(
            (p) => p.id !== target.id && p.position === null
          );
          replacement = pickLikeForLikeBenchPlayer(target.position, benchPool);
          if (replacement) {
            backfillSub = {
              playerOutId: target.id,
              playerOutName: target.name,
              playerInId: replacement.id,
              playerInName: replacement.name,
              position: target.position,
            };
          }
        }
        return prev.map((p) => {
          if (p.id === target.id) {
            // At 5 fouls (FIBA) → fouled out: bench immediately and lock out
            // via a dedicated `isFouledOut` flag (NOT isInjured — that was
            // misleading the UI to show an injury badge).
            const next = transitionPosition(p, fouledOut ? null : p.position);
            return {
              ...next,
              fouls: newCount,
              isFouledOut: fouledOut ? true : p.isFouledOut,
            };
          }
          if (replacement && p.id === replacement.id && backfillSub) {
            return transitionPosition(p, backfillSub.position);
          }
          return p;
        });
      });
      if (backfillSub) {
        appendSubLog({ ...backfillSub, source: "auto" });
      }
      if (newCount >= 5) {
        toast({
          title: "Fouled out",
          description: wasOnCourt
            ? backfillSub
              ? `${playerName} (${newCount}F) → ${(backfillSub as { playerInName: string }).playerInName} ON at ${(backfillSub as { position: string }).position}.`
              : `${playerName} (${newCount}F) sent to bench. No bench replacement available.`
            : `${playerName} has ${newCount} fouls and is locked out.`,
          variant: "destructive",
        });
      }
    },
    [toast, appendSubLog]
  );

  /** Coach override — clear a foul-out flag (e.g. miscount). */
  const clearFoulOut = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, isFouledOut: false, fouls: Math.min(p.fouls ?? 0, 4) } : p
      )
    );
  }, []);

  // ---------- Generate auto-sub plan when settings or roster change ----------
  // Signature changes when bench composition or on-court positions change,
  // so manual swaps + roster edits trigger a fresh plan (no stale closure).
  const rosterSignature = useMemo(
    () =>
      players
        .map((p) => `${p.id}:${p.position ?? "bench"}:${p.isInjured || p.isFouledOut ? "x" : "o"}`)
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
          timerState.minutesPerQuarter,
          timerState.periodType ?? "quarters"
        )
      );
    } else if (rotationMode === "quarter-break") {
      setAutoSubPlan(
        generateQuarterBreakRotationPlan(players, 3, timerState.periodType ?? "quarters")
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter, timerState.periodType, rosterSignature]);

  // ---------- Auto-sub control panel handlers ----------
  /**
   * Execute the next due (or upcoming) sub immediately, regardless of clock.
   * Scoped to the CURRENT quarter only (audit fix B8) — staying consistent
   * with `findNextDueSub`. Pulling forward a Q3 sub during Q1 yanks a starter
   * for no reason and breaks coach mental model.
   */
  const executeNextSubNow = useCallback(() => {
    const target = autoSubPlan.find(
      (s) =>
        !s.executed &&
        !s.skipped &&
        s.quarter === timerState.currentQuarter
    );
    if (!target) {
      toast({ title: "No subs queued this period" });
      return;
    }
    executeSub(target);
  }, [autoSubPlan, timerState.currentQuarter, executeSub, toast]);

  /**
   * Mark the next pending sub (or batch at same quarter+time) as skipped.
   * Scoped to the current quarter only (audit fix B8).
   */
  const skipNextSub = useCallback(() => {
    const target = autoSubPlan.find(
      (s) =>
        !s.executed &&
        !s.skipped &&
        s.quarter === timerState.currentQuarter
    );
    if (!target) {
      toast({ title: "No subs queued this period" });
      return;
    }
    // Mark the batch as skipped AND drop other pending entries so the
    // regen below rebuilds a fresh plan from current minutes (the history
    // filter keeps executed/skipped entries; remaining pending ones would
    // otherwise be carried over verbatim and block re-balancing).
    setAutoSubPlan((prev) =>
      prev
        .map((s) =>
          !s.executed && !s.skipped && s.quarter === target.quarter && s.time === target.time
            ? { ...s, skipped: true }
            : s
        )
        .filter((s) => s.executed || s.skipped)
    );
    // Defer regen so it sees the updated plan state.
    setTimeout(() => regenerateAutoSubPlanRef.current?.(), 0);
    toast({ title: "Sub skipped", description: "Plan regenerated from current minutes." });
  }, [autoSubPlan, timerState.currentQuarter, toast]);

  /** Drop the entire pending plan (rotation mode stays on; user can regenerate). */
  const cancelAutoSubPlan = useCallback(() => {
    setAutoSubPlan((prev) =>
      prev.map((s) => (s.executed ? s : { ...s, skipped: true }))
    );
    toast({ title: "Plan cancelled", description: "All pending auto-subs cleared." });
  }, [toast]);

  /** Re-build the plan from current roster + settings (preserves executed/skipped history). */
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
        : generateQuarterBreakRotationPlan(players, 3, timerState.periodType ?? "quarters");
    // Preserve BOTH executed AND skipped history so a regen never resurrects
    // a sub the coach already actioned (audit fix B7).
    const history = autoSubPlan.filter((s) => s.executed || s.skipped);
    const historyKeys = new Set(history.map(getSubKey));
    // Drop fresh subs whose playerOut is no longer on court — manual swaps
    // that benched the planned playerOut would otherwise queue an invalid
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

  // Ref so earlier callbacks (e.g. skipNextSub) can invoke the latest regen.
  const regenerateAutoSubPlanRef = useRef(regenerateAutoSubPlan);
  useEffect(() => {
    regenerateAutoSubPlanRef.current = regenerateAutoSubPlan;
  }, [regenerateAutoSubPlan]);


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
    const label = periodLabel(nextQ, timerState.periodType);
    const lineup = quarterLineups.find((l) => l.quarter === nextQ);
    if (!lineup || Object.keys(lineup.assignments).length === 0) {
      toast({
        title: "No lineup planned",
        description: `Open the Lineup Planner to set up ${label}.`,
        variant: "destructive",
      });
      return;
    }
    setPlayers((prev) => applyLineup(prev, lineup));
    toast({ title: `${label} lineup applied` });
  }, [quarterLineups, timerState.currentQuarter, timerState.periodType, toast]);

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

  // ---------- Undo last sub ----------
  // Reverts the most recent sub log entry: incoming player back to bench,
  // outgoing player back to their old slot. We also pop the log itself so
  // repeated undo walks back through history.
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
        // Pure sub-off (no incoming) — put player back at their old position
        // if that slot is still empty.
        if (last.playerInId === "" && p.id === last.playerOutId) {
          const slotTaken = prev.some(
            (x) => x.id !== p.id && x.position === last.position
          );
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

  // ---------- MVP / Player of the Match ----------
  const setMvp = useCallback((playerId: string | null) => {
    setTimerState((s) => ({
      ...s,
      mvpPlayerId: playerId,
      lastUpdateTime: Date.now(),
    }));
  }, []);

  // ---------- Timeouts ----------
  const callTimeout = useCallback(
    (side: "home" | "away") => {
      let actuallyCalled = false;
      setTimerState((s) => {
        const key = side === "home" ? "homeTimeoutsRemaining" : "awayTimeoutsRemaining";
        const remaining = s[key] ?? s.timeoutsPerHalf ?? 3;
        if (remaining <= 0) return s;
        actuallyCalled = true;
        return {
          ...s,
          [key]: remaining - 1,
          // Pause the clock — timeouts always stop play.
          isRunning: false,
          lastUpdateTime: Date.now(),
        };
      });
      if (actuallyCalled) {
        cueTimeout();
        toast({
          title: "Timeout",
          description: side === "home" ? "Home timeout called." : "Away timeout called.",
        });
      }
    },
    [toast]
  );

  const resetTimeoutsForCurrentHalf = useCallback(() => {
    setTimerState((s) => {
      const allowance = s.timeoutsPerHalf ?? 3;
      return {
        ...s,
        homeTimeoutsRemaining: allowance,
        awayTimeoutsRemaining: allowance,
        lastUpdateTime: Date.now(),
      };
    });
  }, []);

  const setTimeoutsPerHalf = useCallback((n: number) => {
    const safe = Math.max(0, Math.min(10, Math.floor(n)));
    setTimerState((s) => ({
      ...s,
      timeoutsPerHalf: safe,
      // Bump remaining so a coach increasing the allowance mid-half sees the new max.
      homeTimeoutsRemaining: Math.min(safe, s.homeTimeoutsRemaining ?? safe),
      awayTimeoutsRemaining: Math.min(safe, s.awayTimeoutsRemaining ?? safe),
      lastUpdateTime: Date.now(),
    }));
  }, []);

  // ---------- Free throws ----------
  // Each made FT credits +1 to the player's points (and to the team score
  // via a normal scoreLog entry so the per-quarter strip stays accurate).
  const addFreeThrows = useCallback(
    (playerId: string, made: number, attempted: number) => {
      const safeMade = Math.max(0, Math.min(attempted, Math.floor(made)));
      const safeAtt = Math.max(0, Math.floor(attempted));
      if (safeAtt === 0) return;
      // Update per-player FT counters + points.
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? {
                ...p,
                ftMade: (p.ftMade ?? 0) + safeMade,
                ftAttempted: (p.ftAttempted ?? 0) + safeAtt,
                points: (p.points ?? 0) + safeMade,
              }
            : p
        )
      );
      // Add the made FTs to the team score as a single 1pt-each event chain
      // so QuarterScoreStrip + final score reflect the change. Stagger
      // timestamps by index so events with shared `at` don't collide and
      // collapse into a single dot in MomentumStrip (audit fix B9).
      if (safeMade > 0) {
        setTimerState((s) => {
          const baseAt = Date.now();
          const events = Array.from({ length: safeMade }).map((_, i) => ({
            id: crypto.randomUUID(),
            side: "home" as const,
            points: 1,
            quarter: s.currentQuarter,
            at: baseAt + i,
            playerId,
          }));
          return {
            ...s,
            homeScore: (s.homeScore ?? 0) + safeMade,
            scoreLog: trimLog([...(s.scoreLog ?? []), ...events], SCORE_LOG_MAX),
            lastUpdateTime: Date.now(),
          };
        });
      }
      toast({
        title: "Free throws",
        description: `${safeMade}/${safeAtt} made.`,
      });
    },
    [toast]
  );

  // ---------- Period type (quarters vs halves) ----------
  // When switching to halves we collapse 4 quarters → 2 halves by doubling
  // the timer length so total game minutes stay stable. The currentQuarter
  // counter still goes 1..4 internally for compatibility.
  const setPeriodType = useCallback((next: "quarters" | "halves") => {
    setTimerState((s) => {
      const prev = s.periodType ?? "quarters";
      if (prev === next) return s;
      // Double minutes when going to halves; halve when returning to quarters.
      const baseline =
        prev === "halves" ? Math.max(4, Math.round(s.minutesPerQuarter / 2)) : s.minutesPerQuarter;
      const newMinutes =
        next === "halves" ? baseline * 2 : baseline;
      return {
        ...s,
        periodType: next,
        minutesPerQuarter: newMinutes,
        lastUpdateTime: Date.now(),
      };
    });
  }, []);

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
    // mid-quarter auto-sub confirm
    pendingAutoSub,
    confirmPendingAutoSub,
    cancelPendingAutoSub,
    // derived
    bench,
    nextSub,
    quickActionPlayer,
    // handlers
    handleTick,
    handleQuarterEnd,
    handlePlayerClick,
    handlePlayerLongPress,
    handleSlotClick,
    recentlySwappedIds,
    performSwap,
    subOff,
    assignToPosition,
    toggleInjured,
    addFoul,
    clearFoulOut,
    applyNextLineupNow,
    // presets + view
    lineupPresets,
    setLineupPresets,
    applyPreset,
    courtView,
    toggleCourtView,
    // scoring
    addScore,
    attributeScore,
    undoScore,
    setOpponentName,
    // post-game
    undoLastSub,
    canUndoSub: (timerState.subLog?.length ?? 0) > 0,
    setMvp,
    // timeouts
    callTimeout,
    resetTimeoutsForCurrentHalf,
    setTimeoutsPerHalf,
    // free throws + period type
    addFreeThrows,
    setPeriodType,
    // auto-sub control panel
    autoSubPlan,
    autoSubPaused,
    lockedPlayerIds,
    toggleAutoSubPaused,
    toggleLockPlayer,
    executeNextSubNow,
    skipNextSub,
    cancelAutoSubPlan,
    regenerateAutoSubPlan,
    // full reset
    resetPlayerStats,
  };
}
