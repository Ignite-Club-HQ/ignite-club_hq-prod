import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Pause, Play, SkipForward, RefreshCw, Lock, Unlock,
  X, Check, Pencil, Clock, ChevronDown, ChevronUp, MoreHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Player, SubstitutionEvent } from "./types";

interface AutoSubControlPanelProps {
  autoSubPlan: SubstitutionEvent[];
  autoSubPaused: boolean;
  players: Player[];
  lockedPlayerIds: Set<string>;
  currentElapsedSeconds: number;
  currentHalf: 1 | 2;
  minutesPerHalf: number;
  onTogglePause: () => void;
  onCancelPlan: () => void;
  onSkipNext: () => void;
  onExecuteNow: () => void;
  onEditPlan: () => void;
  onRegeneratePlan: () => void;
  onToggleLockPlayer: (playerId: string) => void;
  onClose: () => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function AutoSubControlPanel({
  autoSubPlan,
  autoSubPaused,
  players,
  lockedPlayerIds,
  currentElapsedSeconds,
  currentHalf,
  minutesPerHalf,
  onTogglePause,
  onCancelPlan,
  onSkipNext,
  onExecuteNow,
  onEditPlan,
  onRegeneratePlan,
  onToggleLockPlayer,
  onClose,
}: AutoSubControlPanelProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showLockPanel, setShowLockPanel] = useState(false);

  const executedSubs = useMemo(() => autoSubPlan.filter(s => s.executed), [autoSubPlan]);
  const remainingSubs = useMemo(() => autoSubPlan.filter(s => !s.executed), [autoSubPlan]);

  const nextSub = useMemo(() => {
    return remainingSubs.find(s => s.half === currentHalf && s.time >= currentElapsedSeconds)
      || remainingSubs.find(s => s.half > currentHalf)
      || remainingSubs[0];
  }, [remainingSubs, currentHalf, currentElapsedSeconds]);

  const onPitchPlayers = useMemo(() =>
    players.filter(p => p.position !== null && p.currentPitchPosition !== "GK"),
    [players]
  );

  return (
    <div className="fixed inset-0 z-[9998] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative z-[9999] w-full max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile feel) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Auto Substitutions
            </h3>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Next Sub Card */}
          {nextSub ? (
            <button
              type="button"
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-all",
                autoSubPaused
                  ? "border-muted bg-muted/30 opacity-60"
                  : "border-primary/30 bg-primary/5 hover:bg-primary/10 active:bg-primary/15"
              )}
              onClick={!autoSubPaused ? onExecuteNow : undefined}
              disabled={autoSubPaused}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Next Sub {!autoSubPaused && <span className="text-primary font-semibold">· Tap to execute</span>}
                </span>
                <Badge variant="secondary" className="font-mono text-xs h-6 px-2">
                  {nextSub.half === 2 && nextSub.time === 0
                    ? "HT"
                    : `${nextSub.half === 2 ? "2H " : ""}${formatTime(nextSub.time)}`}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-base">
                <span className="text-destructive font-semibold truncate">
                  ↓ {nextSub.playerOut.number ? `#${nextSub.playerOut.number} ` : ""}{nextSub.playerOut.name}
                </span>
                <span className="text-muted-foreground text-sm">→</span>
                <span className="text-green-600 dark:text-green-400 font-semibold truncate">
                  ↑ {nextSub.playerIn.number ? `#${nextSub.playerIn.number} ` : ""}{nextSub.playerIn.name}
                </span>
              </div>
              {nextSub.positionSwap && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  + {nextSub.positionSwap.player.name} moves {nextSub.positionSwap.fromPosition} → {nextSub.positionSwap.toPosition}
                </p>
              )}
            </button>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              All substitutions completed
            </div>
          )}

          {/* Primary Actions: Pause + Skip */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={autoSubPaused ? "default" : "outline"}
              className="h-11 gap-2"
              onClick={onTogglePause}
            >
              {autoSubPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {autoSubPaused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={onSkipNext}
              disabled={!nextSub || autoSubPaused}
            >
              <SkipForward className="h-4 w-4" />
              Skip
            </Button>
          </div>

          {/* Secondary Actions: Regenerate + Lock */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={onRegeneratePlan}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              className={cn("h-11 gap-2", showLockPanel && "bg-accent")}
              onClick={() => setShowLockPanel(prev => !prev)}
            >
              <Lock className="h-4 w-4" />
              Lock ({lockedPlayerIds.size})
            </Button>
          </div>

          {/* Lock Player Panel */}
          {showLockPanel && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">
                Locked players won't be subbed off
              </p>
              <div className="flex flex-wrap gap-1.5">
                {onPitchPlayers.map(player => {
                  const isLocked = lockedPlayerIds.has(player.id);
                  return (
                    <Button
                      key={player.id}
                      size="sm"
                      variant={isLocked ? "default" : "outline"}
                      className={cn("h-8 text-xs gap-1 px-2.5", isLocked && "bg-amber-600 hover:bg-amber-700 text-white")}
                      onClick={() => onToggleLockPlayer(player.id)}
                    >
                      {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      {player.number ? `#${player.number} ` : ""}{player.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tertiary Actions: Edit Plan + Timeline */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={() => { onEditPlan(); onClose(); }}
            >
              <Pencil className="h-4 w-4" />
              Edit Plan
            </Button>
            <Button
              variant="outline"
              className={cn("h-11 gap-2", showTimeline && "bg-accent")}
              onClick={() => setShowTimeline(prev => !prev)}
            >
              {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Timeline ({executedSubs.length}/{autoSubPlan.length})
            </Button>
          </div>

          {/* Scrollable Mini-Timeline */}
          {showTimeline && (
            <div className="rounded-xl border border-border overflow-hidden">
              <ScrollArea className="max-h-[200px]">
                <div className="divide-y divide-border">
                  {autoSubPlan.map((sub, idx) => {
                    const isDue = !sub.executed && sub.half === currentHalf && sub.time <= currentElapsedSeconds;
                    const isNext = nextSub && sub === nextSub;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2.5 text-sm",
                          sub.executed
                            ? "bg-muted/20 text-muted-foreground"
                            : isNext
                              ? "bg-primary/10"
                              : isDue
                                ? "bg-amber-500/10"
                                : ""
                        )}
                      >
                        <div className="shrink-0">
                          {sub.executed ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : isNext ? (
                            <Clock className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30" />
                          )}
                        </div>
                        <Badge variant="secondary" className="font-mono text-xs h-5 shrink-0">
                          {sub.half === 2 && sub.time === 0
                            ? "HT"
                            : `${sub.half === 2 ? "2H " : ""}${formatTime(sub.time)}`}
                        </Badge>
                        <div className={cn("flex items-center gap-1 min-w-0 flex-1", sub.executed && "line-through")}>
                          <span className="text-destructive truncate">
                            ↓{sub.playerOut.name}
                          </span>
                          <span className="text-muted-foreground text-xs">→</span>
                          <span className="text-green-600 dark:text-green-400 truncate">
                            ↑{sub.playerIn.name}
                          </span>
                        </div>
                        {!sub.executed && lockedPlayerIds.has(sub.playerOut.id) && (
                          <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Cancel Plan */}
          <Button
            variant="ghost"
            className="w-full h-11 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => { onCancelPlan(); onClose(); }}
          >
            <X className="h-4 w-4 mr-1.5" />
            Cancel Plan
          </Button>
        </div>
      </div>
    </div>
  );
}
