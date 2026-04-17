import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  Settings,
  Users,
  ArrowLeftRight,
  Calendar,
  AlertTriangle,
  Zap,
  Loader2,
  UserCog,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import NetballCourt from "./NetballCourt";
import NetballPlayerToken from "./NetballPlayerToken";
import NetballQuarterTimer from "./NetballQuarterTimer";

import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  NETBALL_POSITION_LABELS,
  POSITION_SLOTS,
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
  findPlayerInPosition,
  applyLineup,
  isPositionAllowedForPlayer,
  generateTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan,
  findNextDueSub,
  safeLoad,
  safeSave,
  formatTime,
} from "./netballHelpers";

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
}: NetballBoardProps) {
  const { toast } = useToast();
  const stateKey = getNetballStateKey(teamId);
  const timerKey = getNetballTimerKey(teamId);

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
      .filter(m => m.role === "player" || m.role === "parent" || m.role === "coach")
      .slice(0, 14)
      .map((m, idx) => ({
        id: m.id,
        name: m.profiles?.display_name?.trim() || `Player ${idx + 1}`,
        // First 7 go on court at fixed slots, the rest sit on the bench.
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
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineupPlannerOpen, setLineupPlannerOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [quickActionPlayerId, setQuickActionPlayerId] = useState<string | null>(null);
  const [pendingSubOnId, setPendingSubOnId] = useState<string | null>(null);


  // ---------- Persistence ----------
  useEffect(() => {
    const state: NetballBoardState = {
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
    };
    safeSave(stateKey, state);
  }, [
    teamId,
    players,
    timerState.currentQuarter,
    rotationMode,
    rotationIntervalMinutes,
    validationMode,
    autoSubPlan,
    quarterLineups,
    stateKey,
  ]);

  useEffect(() => {
    safeSave(timerKey, timerState);
  }, [timerState, timerKey]);

  // ---------- Time tracking ----------
  const handleTick = useCallback((elapsed: number, quarter: Quarter) => {
    // Add 1s of play to every on-court player
    setPlayers(prev =>
      prev.map(p =>
        p.position !== null
          ? { ...p, minutesPlayed: (p.minutesPlayed ?? 0) + 1 }
          : p
      )
    );

    // Auto-sub fire-check (time-based)
    if (rotationMode !== "off") {
      const due = findNextDueSub(autoSubPlan, quarter, elapsed);
      if (due) executeSub(due);
    }
  }, [autoSubPlan, rotationMode]); // executeSub is stable via setState callbacks

  // ---------- Sub execution ----------
  const executeSub = useCallback((sub: NetballSubEvent) => {
    setPlayers(prev => {
      const out = prev.find(p => p.id === sub.playerOut.id);
      const inP = prev.find(p => p.id === sub.playerIn.id);
      if (!out?.position || !inP || inP.position !== null) return prev;
      return prev.map(p => {
        if (p.id === out.id) return { ...p, position: null };
        if (p.id === inP.id) return { ...p, position: sub.position };
        return p;
      });
    });
    setAutoSubPlan(prev =>
      prev.map(s => (s === sub ? { ...s, executed: true } : s))
    );
    toast({
      title: "Auto-sub",
      description: `${sub.playerIn.name} ON for ${sub.playerOut.name} at ${sub.position}`,
    });
  }, [toast]);

  // ---------- Quarter end → quarter-break rotations + apply next lineup ----------
  const handleQuarterEnd = useCallback((endedQuarter: Quarter) => {
    const nextQuarter = (endedQuarter + 1) as Quarter;
    if (nextQuarter > 4) {
      toast({ title: "Game finished", description: "Q4 complete." });
      return;
    }

    // 1. Apply next pre-planned lineup if one exists
    const nextLineup = quarterLineups.find(l => l.quarter === nextQuarter);
    if (nextLineup && Object.keys(nextLineup.assignments).length > 0) {
      setPlayers(prev => applyLineup(prev, nextLineup));
      toast({
        title: `Q${nextQuarter} lineup applied`,
        description: "On-court 7 updated from your plan.",
      });
      return;
    }

    // 2. Otherwise fire any scheduled quarter-break subs for this transition
    if (rotationMode === "quarter-break") {
      const dueSubs = autoSubPlan.filter(
        s => !s.executed && s.quarter === nextQuarter && s.time === 0
      );
      dueSubs.forEach(executeSub);
    }
  }, [autoSubPlan, executeSub, quarterLineups, rotationMode, toast]);

  // ---------- Manual swap / sub interactions ----------
  const handlePlayerClick = useCallback((playerId: string) => {
    if (readOnly) return;
    if (!selectedPlayerId) {
      setSelectedPlayerId(playerId);
      return;
    }
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId(null);
      return;
    }
    // Two players selected → swap or sub
    setPlayers(prev => {
      const a = prev.find(p => p.id === selectedPlayerId);
      const b = prev.find(p => p.id === playerId);
      if (!a || !b) return prev;

      // Validation
      const enforce = (who: NetballPlayer, pos: NetballPosition | null): boolean => {
        if (!pos) return true;
        if (validationMode === "free") return true;
        const ok = isPositionAllowedForPlayer(who, pos);
        if (!ok && validationMode === "warn") {
          toast({
            title: "Position warning",
            description: `${who.name} isn't a preferred ${pos}.`,
            variant: "default",
          });
          return true; // warn but allow
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

      const aOK = enforce(a, b.position);
      const bOK = enforce(b, a.position);
      if (!aOK || !bOK) return prev;

      // Swap their positions
      return prev.map(p => {
        if (p.id === a.id) return { ...p, position: b.position };
        if (p.id === b.id) return { ...p, position: a.position };
        return p;
      });
    });
    setSelectedPlayerId(null);
  }, [selectedPlayerId, validationMode, toast, readOnly]);

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
      setAutoSubPlan(generateQuarterBreakRotationPlan(players, 2));
    }
    // We intentionally only regenerate on settings change, not on every player change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationMode, rotationIntervalMinutes, timerState.minutesPerQuarter]);

  // ---------- Derived ----------
  const onCourt = useMemo(() => getOnCourt(players), [players]);
  const bench = useMemo(() => getBench(players), [players]);
  const nextSub = useMemo(
    () => findNextDueSub(autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds + 30),
    [autoSubPlan, timerState.currentQuarter, timerState.elapsedSeconds]
  );

  const applyNextLineupNow = () => {
    const nextQ = timerState.currentQuarter;
    const lineup = quarterLineups.find(l => l.quarter === nextQ);
    if (!lineup || Object.keys(lineup.assignments).length === 0) {
      toast({
        title: "No lineup planned",
        description: `Open the Lineup Planner to set up Q${nextQ}.`,
        variant: "destructive",
      });
      return;
    }
    setPlayers(prev => applyLineup(prev, lineup));
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

      {/* Action bar */}
      {!readOnly && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/30 overflow-x-auto">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLineupPlannerOpen(true)}>
            <Calendar className="h-3.5 w-3.5 mr-1" /> Lineups
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyNextLineupNow}>
            <Zap className="h-3.5 w-3.5 mr-1" /> Apply Q{timerState.currentQuarter}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-3.5 w-3.5 mr-1" /> Settings
          </Button>
          {rotationMode !== "off" && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              Auto: {rotationMode === "time-based" ? `${rotationIntervalMinutes}m` : "qtr-break"}
            </span>
          )}
        </div>
      )}

      {/* Court */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-pitch-green/20 p-2">
        <div className="relative w-full max-w-sm aspect-[1/2] mx-auto">
          <NetballCourt className="absolute inset-0 w-full h-full rounded-lg" />

          {/* Position slots — render player tokens on top */}
          {NETBALL_POSITIONS.map(pos => {
            const slot = POSITION_SLOTS[pos];
            const player = findPlayerInPosition(players, pos);
            return (
              <div
                key={pos}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                {player ? (
                  <NetballPlayerToken
                    player={player}
                    position={pos}
                    variant="court"
                    isSelected={selectedPlayerId === player.id}
                    isSwapTarget={!!selectedPlayerId && selectedPlayerId !== player.id}
                    isNextSub={nextSub?.playerOut.id === player.id}
                    onClick={() => handlePlayerClick(player.id)}
                    readOnly={readOnly}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPlayerId) return;
                      // Move selected player into empty slot
                      setPlayers(prev =>
                        prev.map(p =>
                          p.id === selectedPlayerId ? { ...p, position: pos } : p
                        )
                      );
                      setSelectedPlayerId(null);
                    }}
                    className={cn(
                      "w-12 h-12 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center text-[10px] font-bold text-white/70 hover:border-white/80 transition",
                      selectedPlayerId && "border-primary text-primary animate-pulse"
                    )}
                    aria-label={`Empty ${pos} slot`}
                  >
                    {pos}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bench */}
      <div className="border-t bg-card">
        <div className="flex items-center justify-between px-3 py-1.5">
          <h2 className="text-xs font-bold flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Bench ({bench.length})
          </h2>
          {selectedPlayerId && (
            <span className="text-[10px] text-primary font-medium flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3" /> Tap a player or empty slot
            </span>
          )}
        </div>
        <ScrollArea className="w-full">
          <div className="flex gap-2 px-3 pb-3 min-h-[68px]">
            {bench.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-3">No bench players.</p>
            ) : (
              bench.map(p => (
                <NetballPlayerToken
                  key={p.id}
                  player={p}
                  variant="bench"
                  isSelected={selectedPlayerId === p.id}
                  isSwapTarget={!!selectedPlayerId && selectedPlayerId !== p.id}
                  onClick={() => handlePlayerClick(p.id)}
                  readOnly={readOnly}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Validation hint */}
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

      {/* Dialogs */}
      <Suspense fallback={<DialogLoader />}>
        {settingsOpen && (
          <NetballSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            minutesPerQuarter={timerState.minutesPerQuarter}
            onMinutesPerQuarterChange={n =>
              setTimerState(s => ({ ...s, minutesPerQuarter: n, lastUpdateTime: Date.now() }))
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
      </Suspense>
    </div>
  );
}
