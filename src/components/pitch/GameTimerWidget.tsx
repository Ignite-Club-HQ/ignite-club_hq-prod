import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Play, Pause, Timer, ExternalLink, X, ArrowRightLeft, Clock, UserRoundCheck, ChevronDown, ChevronUp, ArrowDown, ArrowUp, SkipForward, Pencil, Eye } from "lucide-react";
import { Goal } from "./types";
import { PitchPosition } from "./PositionBadge";
import { toast } from "@/hooks/use-toast";

// Storage keys
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';
const PITCH_STATE_KEY = "ignite-pitch-board-state";

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean;
}

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

interface PitchBoardState {
  teamId: string;
  players: Player[];
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  goals?: Goal[];
}

interface SubInfo {
  sub: SubstitutionEvent;
  isDue: boolean;
  secondsUntil: number;
}

const getTeamTimerStorageKey = (teamId: string) => `${TIMER_STORAGE_KEY_BASE}-${teamId}`;

const loadActiveTimerState = (): TimerState | null => {
  try {
    const activeRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (!activeRaw) return null;
    const activeState = JSON.parse(activeRaw) as TimerState;
    if (activeState.teamId) {
      const teamKey = getTeamTimerStorageKey(activeState.teamId);
      const teamRaw = localStorage.getItem(teamKey);
      if (teamRaw) return JSON.parse(teamRaw) as TimerState;
    }
    return activeState;
  } catch { return null; }
};

const saveTimerState = (state: TimerState) => {
  try {
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(state));
    if (state.teamId) {
      localStorage.setItem(getTeamTimerStorageKey(state.teamId), JSON.stringify(state));
    }
  } catch { /* ignore */ }
};

const getCurrentElapsed = (timer: TimerState): number => {
  let elapsed = timer.elapsedSeconds;
  if (timer.isRunning && timer.lastUpdateTime) {
    const secondsPassed = Math.floor((Date.now() - timer.lastUpdateTime) / 1000);
    elapsed = Math.min(elapsed + secondsPassed, timer.minutesPerHalf * 60);
  }
  return elapsed;
};

const getTotalSeconds = (elapsed: number, half: 1 | 2, minutesPerHalf: number): number => {
  return half === 1 ? elapsed : (minutesPerHalf * 60) + elapsed;
};

interface GameTimerWidgetProps {
  onOpenPitchBoard?: (teamId: string, teamName: string) => void;
  readOnly?: boolean;
}

export default function GameTimerWidget({ onOpenPitchBoard, readOnly = false }: GameTimerWidgetProps) {
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [homeGoals, setHomeGoals] = useState(0);
  const [awayGoals, setAwayGoals] = useState(0);
  const [allSubs, setAllSubs] = useState<SubInfo[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [subsExpanded, setSubsExpanded] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedSubIndex, setSelectedSubIndex] = useState<number>(0);
  const [editedPlayerOutId, setEditedPlayerOutId] = useState<string | null>(null);
  const [editedPlayerInId, setEditedPlayerInId] = useState<string | null>(null);

  const playersOnPitch = useMemo(() => allPlayers.filter(p => p.position !== null), [allPlayers]);
  const availableBenchPlayers = useMemo(() => allPlayers.filter(p => p.position === null && !p.isInjured), [allPlayers]);

  const selectedSub = allSubs[selectedSubIndex] || null;
  const isSelectedSubActionable = selectedSub ? (
    selectedSub.isDue || selectedSubIndex === 0 || allSubs.slice(0, selectedSubIndex).every(s => s.isDue)
  ) : false;

  const actualPlayerOut = useMemo(() => {
    if (!selectedSub) return null;
    if (editedPlayerOutId) return allPlayers.find(p => p.id === editedPlayerOutId) || selectedSub.sub.playerOut;
    return selectedSub.sub.playerOut;
  }, [editedPlayerOutId, allPlayers, selectedSub]);

  const actualPlayerIn = useMemo(() => {
    if (!selectedSub) return null;
    if (editedPlayerInId) return allPlayers.find(p => p.id === editedPlayerInId) || selectedSub.sub.playerIn;
    return selectedSub.sub.playerIn;
  }, [editedPlayerInId, allPlayers, selectedSub]);

  // Poll state
  useEffect(() => {
    const checkState = () => {
      const saved = loadActiveTimerState();
      if (!saved) { setTimerState(null); return; }

      const currentElapsed = getCurrentElapsed(saved);
      setTimerState(saved);
      setDisplaySeconds(currentElapsed);

      try {
        const pitchRaw = localStorage.getItem(PITCH_STATE_KEY);
        if (!pitchRaw) {
          setHomeGoals(0); setAwayGoals(0); setAllSubs([]); setAllPlayers([]);
          return;
        }
        const pitchState: PitchBoardState = JSON.parse(pitchRaw);
        
        // Score
        const goals = pitchState.goals || [];
        setHomeGoals(goals.filter(g => !g.isOpponentGoal).length);
        setAwayGoals(goals.filter(g => g.isOpponentGoal).length);
        
        // Players
        setAllPlayers(pitchState.players || []);

        // Subs - don't show if game is finished
        const mph = saved.minutesPerHalf || 20;
        const isGameFinished = saved.currentHalf === 2 && currentElapsed >= mph * 60;
        const unexecuted = pitchState.autoSubPlan?.filter(s => !s.executed) || [];
        if (pitchState.autoSubActive && unexecuted.length > 0 && saved.isRunning && !isGameFinished) {
          const currentTotal = getTotalSeconds(currentElapsed, saved.currentHalf, mph);
          
          // Auto-skip subs that are more than 90s overdue (mirrors PitchBoard logic)
          const OVERDUE_GRACE_SECONDS = 90;
          const overdueSubs = unexecuted.filter(sub => {
            const subTotal = getTotalSeconds(sub.time, sub.half, mph);
            return currentTotal > subTotal + OVERDUE_GRACE_SECONDS;
          });
          
          if (overdueSubs.length > 0) {
            // Mark overdue subs as executed and reschedule remaining
            const overdueKeys = new Set(overdueSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}`));
            const updatedPlan = (pitchState.autoSubPlan || []).map(s =>
              overdueKeys.has(`${s.half}-${s.time}-${s.playerOut.id}`) ? { ...s, executed: true } : s
            );
            
            // Reschedule remaining unexecuted subs evenly across remaining time
            const stillRemaining = updatedPlan.filter(s => !s.executed);
            if (stillRemaining.length > 0) {
              const totalGameSeconds = mph * 2 * 60;
              const remainingGame = totalGameSeconds - currentTotal;
              const interval = Math.max(Math.floor(remainingGame / (stillRemaining.length + 1)), 60);
              let nextTime = currentTotal + interval;
              const rescheduledPlan = updatedPlan.map(s => {
                if (s.executed) return s;
                const halfDur = mph * 60;
                const newHalf: 1 | 2 = nextTime < halfDur ? 1 : 2;
                const newTime = newHalf === 1 ? nextTime : nextTime - halfDur;
                nextTime += interval;
                return { ...s, half: newHalf, time: Math.floor(newTime) };
              });
              localStorage.setItem(PITCH_STATE_KEY, JSON.stringify({ ...pitchState, autoSubPlan: rescheduledPlan }));
            } else {
              localStorage.setItem(PITCH_STATE_KEY, JSON.stringify({ ...pitchState, autoSubPlan: updatedPlan }));
            }
            window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
            return; // Will pick up updated state on next poll tick
          }
          
          const sorted = [...unexecuted].sort((a, b) => {
            if (a.half !== b.half) return a.half - b.half;
            return a.time - b.time;
          });
          
          const subInfos: SubInfo[] = sorted.map(sub => {
            const subTotal = getTotalSeconds(sub.time, sub.half, mph);
            const isDue = subTotal <= currentTotal;
            return { sub, isDue, secondsUntil: Math.max(0, subTotal - currentTotal) };
          });
          
          // Put due subs first
          subInfos.sort((a, b) => {
            if (a.isDue && !b.isDue) return -1;
            if (!a.isDue && b.isDue) return 1;
            return a.secondsUntil - b.secondsUntil;
          });
          
          setAllSubs(subInfos);
        } else {
          setAllSubs([]);
        }
      } catch { setAllSubs([]); }
    };

    checkState();
    const interval = setInterval(checkState, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = useCallback((seconds: number, half: 1 | 2, minutesPerHalf: number) => {
    const totalSeconds = half === 1 ? seconds : (minutesPerHalf * 60) + seconds;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const toggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!timerState) return;
    // Don't allow resuming if at half-time boundary - user needs to start 2nd half from pitch board
    const isAtHalfBoundary = timerState.isRunning && displaySeconds >= timerState.minutesPerHalf * 60;
    if (isAtHalfBoundary) return;
    saveTimerState({ ...timerState, isRunning: !timerState.isRunning, lastUpdateTime: Date.now(), elapsedSeconds: displaySeconds });
    setTimerState(prev => prev ? { ...prev, isRunning: !prev.isRunning, lastUpdateTime: Date.now(), elapsedSeconds: displaySeconds } : null);
  };

  const handleOpenPitchBoard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerState?.teamId && timerState?.teamName && onOpenPitchBoard) {
      onOpenPitchBoard(timerState.teamId, timerState.teamName);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem(ACTIVE_TIMER_KEY);
    if (timerState?.teamId) localStorage.removeItem(getTeamTimerStorageKey(timerState.teamId));
    try {
      const raw = localStorage.getItem(PITCH_STATE_KEY);
      if (raw) {
        const ps = JSON.parse(raw);
        ps.autoSubPlan = []; ps.autoSubActive = false; ps.autoSubPaused = false;
        localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(ps));
      }
    } catch { /* ignore */ }
    localStorage.removeItem(PITCH_STATE_KEY);
    setTimerState(null);
  };

  const openSubDialog = (index: number) => {
    setSelectedSubIndex(index);
    setEditedPlayerOutId(null);
    setEditedPlayerInId(null);
    setShowConfirmDialog(true);
  };

  const executeSubstitution = () => {
    if (!selectedSub) return;
    const { sub } = selectedSub;
    try {
      const pitchRaw = localStorage.getItem(PITCH_STATE_KEY);
      const timerRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (!pitchRaw) return;

      const pitchState: PitchBoardState = JSON.parse(pitchRaw);
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerRaw) {
        const ts: TimerState = JSON.parse(timerRaw);
        minutesPerHalf = ts.minutesPerHalf || 20;
        currentHalf = ts.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(ts);
      }

      const playerOut = actualPlayerOut || sub.playerOut;
      const playerIn = actualPlayerIn || sub.playerIn;
      const currentPlayerOut = pitchState.players.find(p => p.id === playerOut.id);
      const currentPlayerIn = pitchState.players.find(p => p.id === playerIn.id);

      if (!currentPlayerOut?.position || !currentPlayerIn || currentPlayerIn.position !== null) {
        // Invalid state - mark as executed but don't swap
        const updatedPlan = pitchState.autoSubPlan.map(s =>
          s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
            ? { ...s, executed: true } : s
        );
        localStorage.setItem(PITCH_STATE_KEY, JSON.stringify({ ...pitchState, autoSubPlan: updatedPlan }));
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
        toast({ title: "Sub not made – players already moved", description: `${playerOut.name} is no longer on pitch or ${playerIn.name} is already playing. No changes were made.`, variant: "destructive" });
        setShowConfirmDialog(false);
        return;
      }

      const pitchPosition = { ...currentPlayerOut.position };
      const pitchPositionType = currentPlayerOut.currentPitchPosition;
      const updatedPlayers = pitchState.players.map(p => {
        if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
        if (p.id === playerIn.id) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        return p;
      });

      const subTotal = getTotalSeconds(sub.time, sub.half, minutesPerHalf);
      const currentTotal = getTotalSeconds(currentElapsedSeconds, currentHalf, minutesPerHalf);
      const delaySeconds = Math.max(0, currentTotal - subTotal);

      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true } : s
      );

      if (delaySeconds > 30) {
        const remaining = updatedPlan.filter(s => !s.executed);
        if (remaining.length > 0) {
          const totalGameSeconds = minutesPerHalf * 2 * 60;
          const remainingGame = totalGameSeconds - currentTotal;
          const interval = Math.max(Math.floor(remainingGame / (remaining.length + 1)), 60);
          let nextTime = currentTotal + interval;
          updatedPlan = updatedPlan.map(s => {
            if (s.executed) return s;
            const halfDur = minutesPerHalf * 60;
            const newHalf: 1 | 2 = nextTime < halfDur ? 1 : 2;
            const newTime = newHalf === 1 ? nextTime : nextTime - halfDur;
            nextTime += interval;
            return { ...s, half: newHalf, time: Math.floor(newTime) };
          });
        }
      }

      localStorage.setItem(PITCH_STATE_KEY, JSON.stringify({ ...pitchState, autoSubPlan: updatedPlan, players: updatedPlayers }));
      window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      toast({ title: "Substitution made", description: `${playerIn.name} on for ${playerOut.name}` });
    } catch (e) {
      console.error("[GameTimerWidget] Error executing sub:", e);
      toast({ title: "Error", description: "Failed to execute substitution", variant: "destructive" });
    }
    setShowConfirmDialog(false);
  };

  const skipSubstitution = () => {
    if (!selectedSub) return;
    const { sub } = selectedSub;
    try {
      const pitchRaw = localStorage.getItem(PITCH_STATE_KEY);
      const timerRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (!pitchRaw) return;

      const pitchState: PitchBoardState = JSON.parse(pitchRaw);
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerRaw) {
        const ts: TimerState = JSON.parse(timerRaw);
        minutesPerHalf = ts.minutesPerHalf || 20;
        currentHalf = ts.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(ts);
      }
      const currentTotal = getTotalSeconds(currentElapsedSeconds, currentHalf, minutesPerHalf);

      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true } : s
      );

      const remaining = updatedPlan.filter(s => !s.executed);
      if (remaining.length > 0) {
        const totalGameSeconds = minutesPerHalf * 2 * 60;
        const remainingGame = totalGameSeconds - currentTotal;
        const interval = Math.max(Math.floor(remainingGame / (remaining.length + 1)), 60);
        let nextTime = currentTotal + interval;
        updatedPlan = updatedPlan.map(s => {
          if (s.executed) return s;
          const halfDur = minutesPerHalf * 60;
          const newHalf: 1 | 2 = nextTime < halfDur ? 1 : 2;
          const newTime = newHalf === 1 ? nextTime : nextTime - halfDur;
          nextTime += interval;
          return { ...s, half: newHalf, time: Math.floor(newTime) };
        });
      }

      localStorage.setItem(PITCH_STATE_KEY, JSON.stringify({ ...pitchState, autoSubPlan: updatedPlan }));
      window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      toast({ title: "Substitution skipped", description: "Remaining subs have been rescheduled" });
    } catch (e) {
      console.error("[GameTimerWidget] Error skipping sub:", e);
      toast({ title: "Error", description: "Failed to skip substitution", variant: "destructive" });
    }
    setShowConfirmDialog(false);
  };

  // Don't show if no timer state, timer hasn't started, or game has concluded
  const isGameConcluded = timerState?.currentHalf === 2 && displaySeconds >= (timerState?.minutesPerHalf || 0) * 60;
  if (!timerState || (timerState.elapsedSeconds === 0 && !timerState.isRunning && timerState.currentHalf === 1) || isGameConcluded) {
    return null;
  }

  const halfLabel = timerState.currentHalf === 1 ? "1st Half" : "2nd Half";
  const hasScore = homeGoals > 0 || awayGoals > 0;
  const firstSub = allSubs[0] || null;

  const formatSubCountdown = (info: SubInfo) => {
    if (info.isDue) return "Sub due now";
    const mins = Math.floor(info.secondsUntil / 60);
    const secs = info.secondsUntil % 60;
    if (mins > 0) return `Sub in ${mins}:${secs.toString().padStart(2, '0')}`;
    return `Sub in ${secs}s`;
  };

  return (
    <>
      <Card className={`relative ${firstSub?.isDue ? "border-warning/50 bg-warning/5" : "border-primary/30 bg-primary/5"}`}>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground z-10"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <CardContent className="p-3 pr-8">
          {/* Main row: Timer + Score + Controls */}
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full shrink-0 ${firstSub?.isDue ? "bg-warning/20" : "bg-primary/10"}`}>
              <Timer className={`h-5 w-5 ${firstSub?.isDue ? "text-warning" : "text-primary"} ${timerState.isRunning ? 'animate-pulse' : ''}`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-bold text-primary">
                  {formatTime(displaySeconds, timerState.currentHalf, timerState.minutesPerHalf)}
                </span>
                {timerState.isRunning && (
                  <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                )}
                {hasScore && (
                  <span className="text-sm font-semibold text-muted-foreground ml-1">
                    {homeGoals} - {awayGoals}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{halfLabel}</span>
                {timerState.teamName && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground truncate">{timerState.teamName}</span>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
              {!readOnly && (() => {
                // At half time boundary, the widget may read isRunning=true from localStorage
                // before the GameTimer component processes the half-time pause.
                // Detect this and show Play instead of Pause.
                const isEffectivelyPaused = !timerState.isRunning || 
                  (timerState.isRunning && displaySeconds >= timerState.minutesPerHalf * 60);
                return (
                  <Button variant="outline" size="icon" className="h-10 w-10" onClick={toggleTimer}>
                    {!isEffectivelyPaused ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                );
              })()}
              {timerState.teamId && timerState.teamName && onOpenPitchBoard && (
                <Button variant="default" size="icon" className="h-10 w-10" onClick={handleOpenPitchBoard}>
                  <ExternalLink className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>

          {/* Next sub summary row (always visible when subs exist) */}
          {firstSub && (
            <button
              className={`mt-2 w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                firstSub.isDue ? "bg-warning/15 border border-warning/30" : "bg-muted/50"
              }`}
              onClick={() => setSubsExpanded(!subsExpanded)}
            >
              {firstSub.isDue ? (
                <ArrowRightLeft className="h-4 w-4 text-warning shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={`text-xs font-medium flex-1 truncate ${firstSub.isDue ? "text-warning" : "text-muted-foreground"}`}>
                {formatSubCountdown(firstSub)} — {firstSub.sub.playerOut.name} → {firstSub.sub.playerIn.name}
              </span>
              {allSubs.length > 1 && (
                <span className="text-[10px] text-muted-foreground shrink-0">+{allSubs.length - 1} more</span>
              )}
              {subsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          )}

          {/* Expanded sub list */}
          {subsExpanded && allSubs.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {allSubs.map((subInfo, idx) => (
                <div
                  key={`${subInfo.sub.playerOut.id}-${subInfo.sub.playerIn.id}-${subInfo.sub.time}`}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${
                    subInfo.isDue ? "bg-warning/10 border border-warning/20" : "bg-muted/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${subInfo.isDue ? "text-warning" : "text-foreground"}`}>
                      {formatSubCountdown(subInfo)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {subInfo.sub.playerOut.name} → {subInfo.sub.playerIn.name}
                    </p>
                  </div>
                  {!readOnly && (
                    <Button
                      variant={subInfo.isDue ? "default" : "outline"}
                      size="sm"
                      className={`h-8 px-2.5 text-xs gap-1 shrink-0 ${subInfo.isDue ? "bg-warning text-warning-foreground hover:bg-warning/90" : ""}`}
                      onClick={(e) => { e.stopPropagation(); openSubDialog(idx); }}
                    >
                      {subInfo.isDue ? (
                        <>
                          <UserRoundCheck className="h-3.5 w-3.5" />
                          Accept
                        </>
                      ) : idx === 0 || allSubs.slice(0, idx).every(s => s.isDue) ? (
                        <>
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          Make Early
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      {selectedSub && (
        <ResponsiveDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <ResponsiveDialogContent className="sm:max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5" />
                {selectedSub.isDue ? "Make This Substitution" : "Upcoming Substitution"}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {selectedSub.isDue ? "Follow these steps on the pitch" : `Sub scheduled for ${selectedSub.sub.half === 1 ? "1st" : "2nd"} Half`}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            
            {!selectedSub.isDue && (
              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Clock className="h-5 w-5 text-primary animate-pulse" />
                <div className="text-center">
                  <div className="text-lg font-bold text-primary">
                    {Math.floor(selectedSub.secondsUntil / 60)}:{(selectedSub.secondsUntil % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-muted-foreground">until sub is due</div>
                </div>
              </div>
            )}
            
            <div className="space-y-3 py-3">
              {/* Step 1: Player coming off */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">1</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">Move {actualPlayerOut?.name} to the bench</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {actualPlayerOut?.number && `#${actualPlayerOut.number} `}
                    {actualPlayerOut?.currentPitchPosition && `leaves ${actualPlayerOut.currentPitchPosition}`}
                  </div>
                  {!readOnly && isSelectedSubActionable && (
                    <Select value={editedPlayerOutId || selectedSub.sub.playerOut.id} onValueChange={setEditedPlayerOutId}>
                      <SelectTrigger className="w-full h-8 mt-2 text-xs border-destructive/30">
                        <div className="flex items-center gap-1"><Pencil className="h-3 w-3" /><span>Change player</span></div>
                      </SelectTrigger>
                      <SelectContent>
                        {playersOnPitch.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.number ? `#${p.number} ` : ""}{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <ArrowDown className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              </div>
              
              {/* Step 2: Player coming on */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">2</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    Move {actualPlayerIn?.name} to {selectedSub.sub.positionSwap ? selectedSub.sub.positionSwap.fromPosition : (actualPlayerOut?.currentPitchPosition || 'the pitch')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {actualPlayerIn?.number && `#${actualPlayerIn.number} `}comes on from bench
                  </div>
                  {!readOnly && isSelectedSubActionable && (
                    <Select value={editedPlayerInId || selectedSub.sub.playerIn.id} onValueChange={setEditedPlayerInId}>
                      <SelectTrigger className="w-full h-8 mt-2 text-xs border-emerald-500/30">
                        <div className="flex items-center gap-1"><Pencil className="h-3 w-3" /><span>Change player</span></div>
                      </SelectTrigger>
                      <SelectContent>
                        {availableBenchPlayers.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.number ? `#${p.number} ` : ""}{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <ArrowUp className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              </div>
              
              {/* Step 3: Position swap */}
              {selectedSub.sub.positionSwap && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">3</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">Move {selectedSub.sub.positionSwap.player.name} to {selectedSub.sub.positionSwap.toPosition}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {selectedSub.sub.positionSwap.player.number && `#${selectedSub.sub.positionSwap.player.number} `}
                      shifts from {selectedSub.sub.positionSwap.fromPosition}
                    </div>
                  </div>
                  <ArrowRightLeft className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                </div>
              )}
            </div>

            <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)} className="h-12 text-base sm:order-1">
                <X className="h-4 w-4 mr-2" />Close
              </Button>
              {isSelectedSubActionable && (
                <>
                  <Button variant="outline" onClick={skipSubstitution} className="h-12 text-base sm:order-2">
                    <SkipForward className="h-4 w-4 mr-2" />Skip
                  </Button>
                  <Button onClick={executeSubstitution} className="h-12 text-base sm:order-3">
                    <UserRoundCheck className="h-4 w-4 mr-2" />
                    {selectedSub.isDue ? "Confirm Sub" : "Make Early"}
                  </Button>
                </>
              )}
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </>
  );
}
