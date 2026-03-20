import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Play, Pause, Timer, LayoutGrid, X, ArrowRightLeft, Clock, UserRoundCheck, ChevronDown, ChevronUp, ArrowDown, ArrowUp, SkipForward, Pencil, Eye } from "lucide-react";
import { Goal, getSpecificPositionLabel } from "./types";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { toast } from "@/hooks/use-toast";
import { validateAndFixRemainingPlan } from "./pitchStateUtils";


// Storage keys
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
const WIDGET_DISMISSED_KEY = "pitch-widget-dismissed";
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;

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
  skipped?: boolean;
}

interface PitchBoardState {
  teamId: string;
  players: Player[];
  teamSize: string;
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

    // If widget was dismissed for this team, don't show it
    const dismissed = localStorage.getItem(WIDGET_DISMISSED_KEY);
    if (dismissed && (dismissed === 'true' || dismissed === activeState.teamId)) {
      return null;
    }

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
    // Clear dismissed flag when timer state is actively saved (new game or state change)
    localStorage.removeItem(WIDGET_DISMISSED_KEY);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'timer-widget' } }));
  } catch { /* ignore */ }
};

// Read pitch state: prefer team-specific key, fall back to active key ONLY if teamId matches
const readPitchState = (teamId?: string): PitchBoardState | null => {
  try {
    if (teamId) {
      const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
      if (teamSaved) return JSON.parse(teamSaved);

      // Fallback to active key — but ONLY if it belongs to the same team
      const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
      if (!activeSaved) return null;
      const activeState = JSON.parse(activeSaved) as PitchBoardState;
      return activeState.teamId === teamId ? activeState : null;
    }
    const saved = localStorage.getItem(PITCH_STATE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

// Write pitch state: write to both team-specific and active keys
const writePitchState = (state: PitchBoardState) => {
  try {
    const json = JSON.stringify(state);
    if (state.teamId) localStorage.setItem(getPitchStateKeyForTeam(state.teamId), json);
    localStorage.setItem(PITCH_STATE_KEY, json);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'pitch-widget' } }));
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
  
  // All due subs at the same time slot are actionable together
  const firstDueTimeKey = allSubs.find(s => s.isDue) 
    ? `${allSubs.find(s => s.isDue)!.sub.half}-${allSubs.find(s => s.isDue)!.sub.time}` 
    : null;
  
  const isSubActionable = (subInfo: SubInfo, idx: number) => {
    if (subInfo.isDue) {
      // Actionable if it belongs to the same time slot as the first due sub
      return `${subInfo.sub.half}-${subInfo.sub.time}` === firstDueTimeKey;
    }
    // Future subs: actionable if no due subs exist and it's the first
    return !firstDueTimeKey && idx === 0;
  };
  
  const isSelectedSubActionable = selectedSub ? isSubActionable(selectedSub, selectedSubIndex) : false;

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
        const pitchState = readPitchState(saved.teamId);
        if (!pitchState) {
          setHomeGoals(0); setAwayGoals(0); setAllSubs([]); setAllPlayers([]);
          return;
        }
        
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
        if (pitchState.autoSubActive && unexecuted.length > 0 && !isGameFinished) {
          const currentTotal = getTotalSeconds(currentElapsed, saved.currentHalf, mph);
          
          // Display-only: sort subs by time, mark which are due.
          // Do NOT modify the plan here — GlobalSubMonitor handles auto-skip/recalculation
          // to avoid race conditions that can silently wipe subs.
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

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const toggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!timerState) return;
    
    const mph = timerState.minutesPerHalf || 20;
    const atHalfTimeLimit = displaySeconds >= mph * 60;
    
    // If currently in 1st half and at the time limit, transition to 2nd half
    if (!timerState.isRunning && timerState.currentHalf === 1 && atHalfTimeLimit) {
      const newState = { ...timerState, currentHalf: 2 as 1 | 2, elapsedSeconds: 0, isRunning: true, lastUpdateTime: Date.now() };
      saveTimerState(newState);
      setTimerState(newState);
      setDisplaySeconds(0);
      return;
    }
    
    // Don't allow resuming if game is finished (2nd half at limit)
    if (!timerState.isRunning && timerState.currentHalf === 2 && atHalfTimeLimit) return;
    
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
    // Only hide the widget — do NOT delete timer or pitch state
    const teamId = timerState?.teamId;
    localStorage.setItem(WIDGET_DISMISSED_KEY, teamId || 'true');
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
      const pitchState = readPitchState(timerState?.teamId);
      if (!pitchState) return;

      // Guard: check if this sub was already skipped (e.g., by auto-skip while dialog was open)
      const matchingSub = pitchState.autoSubPlan?.find(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
      );
      if (matchingSub?.executed || matchingSub?.skipped) {
        toast({ title: "Substitution expired", description: "This sub was already skipped — a newer one is due", variant: "destructive" });
        setShowConfirmDialog(false);
        return;
      }
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerState) {
        minutesPerHalf = timerState.minutesPerHalf || 20;
        currentHalf = timerState.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(timerState);
      }

      const playerOut = actualPlayerOut || sub.playerOut;
      const playerIn = actualPlayerIn || sub.playerIn;
      const currentPlayerOut = pitchState.players.find(p => p.id === playerOut.id);
      const currentPlayerIn = pitchState.players.find(p => p.id === playerIn.id);

      if (!currentPlayerOut?.position || !currentPlayerIn || !!currentPlayerIn.position) {
        // Invalid state - skip this sub and recalculate remaining plan
        let updatedPlan = pitchState.autoSubPlan.map(s =>
          s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
            ? { ...s, executed: true, skipped: true } : s
        );

        // Redistribute remaining future subs evenly
        const halfDur = minutesPerHalf * 60;
        const totalGameSeconds = minutesPerHalf * 2 * 60;
        const currentTotal = getTotalSeconds(currentElapsedSeconds, currentHalf, minutesPerHalf);
        const remaining = updatedPlan.filter(s => !s.executed);
        if (remaining.length > 0) {
          const remainingGameSeconds = totalGameSeconds - currentTotal;
          const interval = Math.max(Math.floor(remainingGameSeconds / (remaining.length + 1)), 60);
          let nextSubTime = currentTotal + interval;
          updatedPlan = updatedPlan.map(s => {
            if (s.executed) return s;
            const newHalf: 1 | 2 = nextSubTime < halfDur ? 1 : 2;
            const newTime = newHalf === 1 ? nextSubTime : nextSubTime - halfDur;
            nextSubTime += interval;
            return { ...s, half: newHalf, time: Math.floor(newTime) };
          });
        }

        // Validate remaining plan entries against current player positions
        updatedPlan = validateAndFixRemainingPlan(updatedPlan, pitchState.players);
        writePitchState({ ...pitchState, autoSubPlan: updatedPlan });
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
        toast({ title: "Sub rescheduled", description: `${playerIn.name} is already ${currentPlayerIn?.position ? 'on' : 'off'} the pitch — remaining subs recalculated`, variant: "default" });
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
      const earlyBySeconds = Math.max(0, subTotal - currentTotal);

      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true } : s
      );

      // If the sub was confirmed early (>15s) or late (>30s), redistribute the TIMING
      // of remaining future subs evenly. We only adjust times, not player assignments,
      // since the widget lacks live minutesPlayed data for full recalculation.
      const isSignificantlyEarly = earlyBySeconds > 15;
      const isSignificantlyLate = delaySeconds > 30;

      if (isSignificantlyEarly || isSignificantlyLate) {
        const halfDur = minutesPerHalf * 60;
        const totalGameSeconds = minutesPerHalf * 2 * 60;
        const futureSubs = updatedPlan.filter(s => {
          if (s.executed) return false;
          const sTotal = getTotalSeconds(s.time, s.half, minutesPerHalf);
          return sTotal > currentTotal;
        });

        if (futureSubs.length > 0) {
          const remainingGameSeconds = totalGameSeconds - currentTotal;
          const interval = Math.max(Math.floor(remainingGameSeconds / (futureSubs.length + 1)), 60);
          const futureSubKeys = new Set(futureSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`));
          let nextSubTime = currentTotal + interval;

          updatedPlan = updatedPlan.map(s => {
            if (s.executed) return s;
            const subKey = `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`;
            if (!futureSubKeys.has(subKey)) return s;
            const newHalf: 1 | 2 = nextSubTime < halfDur ? 1 : 2;
            const newTime = newHalf === 1 ? nextSubTime : nextSubTime - halfDur;
            nextSubTime += interval;
            return { ...s, half: newHalf, time: Math.floor(newTime) };
          });
        }
      }

      // Validate remaining plan entries against updated player positions
      const validatedPlan = validateAndFixRemainingPlan(updatedPlan, updatedPlayers);
      writePitchState({ ...pitchState, autoSubPlan: validatedPlan, players: updatedPlayers });
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
      const pitchState = readPitchState(timerState?.teamId);
      if (!pitchState) return;
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerState) {
        minutesPerHalf = timerState.minutesPerHalf || 20;
        currentHalf = timerState.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(timerState);
      }
      const currentTotal = getTotalSeconds(currentElapsedSeconds, currentHalf, minutesPerHalf);

      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true, skipped: true } : s
      );

      const halfDur = minutesPerHalf * 60;
      const remaining = updatedPlan.filter(s => !s.executed);
      
      // Separate due subs (keep them) from future subs (redistribute them)
      const futureSubs = remaining.filter(s => {
        const subTotal = getTotalSeconds(s.time, s.half, minutesPerHalf);
        return subTotal > currentTotal;
      });
      
      if (futureSubs.length > 0) {
        const totalGameSeconds = minutesPerHalf * 2 * 60;
        const remainingGameSeconds = totalGameSeconds - currentTotal;
        const interval = Math.max(Math.floor(remainingGameSeconds / (futureSubs.length + 1)), 60);
        
        const futureSubKeys = new Set(futureSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`));
        let nextSubTime = currentTotal + interval;
        
        updatedPlan = updatedPlan.map(s => {
          if (s.executed) return s;
          const subKey = `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`;
          if (!futureSubKeys.has(subKey)) return s; // Keep due subs unchanged
          
          const newHalf: 1 | 2 = nextSubTime < halfDur ? 1 : 2;
          const newTime = newHalf === 1 ? nextSubTime : nextSubTime - halfDur;
          nextSubTime += interval;
          
          return { ...s, half: newHalf, time: Math.floor(newTime) };
        });
      }

      // Validate remaining plan entries against current player positions
      updatedPlan = validateAndFixRemainingPlan(updatedPlan, pitchState.players);
      writePitchState({ ...pitchState, autoSubPlan: updatedPlan });
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
        <CardContent className="p-3">
          {/* Main row: Timer + Score + Controls */}
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full shrink-0 ${firstSub?.isDue ? "bg-warning/20" : "bg-primary/10"}`}>
              <Timer className={`h-5 w-5 ${firstSub?.isDue ? "text-warning" : "text-primary"} ${timerState.isRunning ? 'animate-pulse' : ''}`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-bold text-primary">
                  {formatTime(displaySeconds)}
                </span>
               {timerState.isRunning && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-destructive/50 text-destructive gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                    LIVE
                  </Badge>
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
                  <LayoutGrid className="h-5 w-5" />
                </Button>
              )}
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={handleDismiss}
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
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
                {firstSub.isDue ? "SUB TIME" : formatSubCountdown(firstSub)} — OUT {firstSub.sub.playerOut.name} · IN {firstSub.sub.playerIn.name}
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
            <div className="mt-1.5 space-y-0.5">
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
                      OUT {subInfo.sub.playerOut.name} · IN {subInfo.sub.playerIn.name}
                    </p>
                  </div>
                  {!readOnly && (() => {
                    const actionable = isSubActionable(subInfo, idx);
                    return (
                      <Button
                        variant={subInfo.isDue && actionable ? "default" : "outline"}
                        size="sm"
                        className={`h-8 px-2.5 text-xs gap-1 shrink-0 ${subInfo.isDue && actionable ? "bg-warning text-warning-foreground hover:bg-warning/90" : ""}`}
                        onClick={(e) => { e.stopPropagation(); openSubDialog(idx); }}
                        disabled={subInfo.isDue && !actionable}
                      >
                        {subInfo.isDue && actionable ? (
                          <>
                            <UserRoundCheck className="h-3.5 w-3.5" />
                            Accept
                          </>
                        ) : subInfo.isDue && !actionable ? (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            Next
                          </>
                        ) : actionable ? (
                          <>
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            Sub Now
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </>
                        )}
                      </Button>
                    );
                  })()}
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
                {undefined}
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
              {(() => {
                const sub = selectedSub.sub;
                const outPos = actualPlayerOut?.currentPitchPosition || sub.playerOut.currentPitchPosition;
                const specificOutPos = outPos ? getSpecificPositionLabel(actualPlayerOut?.position?.x, outPos) : 'Unknown';
                const inTargetPos = sub.positionSwap ? sub.positionSwap.fromPosition : outPos;
                const specificInPos = inTargetPos ? getSpecificPositionLabel(
                  sub.positionSwap ? sub.positionSwap.player.position?.x : actualPlayerOut?.position?.x,
                  inTargetPos
                ) : 'Unknown';
                const inPosColors = inTargetPos ? POSITION_COLORS[inTargetPos] : null;
                return (
                  <>
                    {/* Player coming off */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">
                        {actualPlayerOut?.number || actualPlayerOut?.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{actualPlayerOut?.name}</div>
                        <div className="text-xs text-muted-foreground">{specificOutPos} → Bench</div>
                      </div>
                      <span className="text-sm font-bold text-destructive flex-shrink-0">OUT</span>
                    </div>
                    
                    {/* Player coming on */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">
                        {actualPlayerIn?.number || actualPlayerIn?.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{actualPlayerIn?.name}</div>
                        <div className="text-xs text-muted-foreground">Bench → {specificInPos}</div>
                      </div>
                      {inPosColors && (
                        <span className={cn("text-xs font-bold flex-shrink-0 uppercase", inPosColors.text)}>{specificInPos}</span>
                      )}
                    </div>
                    
                    {/* Position swap */}
                    {sub.positionSwap && (() => {
                      const swapFromSpecific = getSpecificPositionLabel(sub.positionSwap!.player.position?.x, sub.positionSwap!.fromPosition);
                      const swapToSpecific = getSpecificPositionLabel(actualPlayerOut?.position?.x, sub.positionSwap!.toPosition);
                      const toColors = POSITION_COLORS[sub.positionSwap!.toPosition];
                      return (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                            {sub.positionSwap!.player.number || sub.positionSwap!.player.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{sub.positionSwap!.player.name}</div>
                            <div className="text-xs text-muted-foreground">{swapFromSpecific} → {swapToSpecific}</div>
                          </div>
                          <span className={cn("text-xs font-bold flex-shrink-0 uppercase", toColors.text)}>{swapToSpecific}</span>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
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
                    {selectedSub.isDue ? "Confirm Sub" : "Sub Now"}
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
