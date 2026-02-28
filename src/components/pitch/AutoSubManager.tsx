import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Pause, Play, SkipForward, Zap, RefreshCw, Lock, Unlock, 
  X, ChevronDown, ChevronUp, Check, Pencil, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Player, SubstitutionEvent } from "./types";
import { PitchPosition } from "./PositionBadge";

interface AutoSubManagerProps {
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
  compact?: boolean; // for portrait bottom sheet
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function AutoSubManager({
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
  compact = false,
}: AutoSubManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [showLockPanel, setShowLockPanel] = useState(false);

  const executedSubs = useMemo(() => autoSubPlan.filter(s => s.executed), [autoSubPlan]);
  const remainingSubs = useMemo(() => autoSubPlan.filter(s => !s.executed), [autoSubPlan]);
  
  // Next upcoming sub
  const nextSub = useMemo(() => {
    return remainingSubs.find(s => s.half === currentHalf && s.time >= currentElapsedSeconds)
      || remainingSubs.find(s => s.half > currentHalf)
      || remainingSubs[0];
  }, [remainingSubs, currentHalf, currentElapsedSeconds]);

  // Get on-pitch players for lock panel
  const onPitchPlayers = useMemo(() => 
    players.filter(p => p.position !== null && p.currentPitchPosition !== "GK"),
    [players]
  );

  const halfDurationSecs = minutesPerHalf * 60;

  return (
    <div className="space-y-2">
      {/* Next Sub Preview Card */}
      {nextSub && (
        <div className={cn(
          "rounded-lg border p-2.5",
          autoSubPaused 
            ? "border-muted bg-muted/30" 
            : "border-primary/30 bg-primary/5"
        )}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Next Sub
            </span>
            <Badge variant="secondary" className="font-mono text-[10px] h-5">
              {nextSub.half === 2 && nextSub.time === 0 
                ? "HT" 
                : `${nextSub.half === 2 ? "2H " : ""}${formatTime(nextSub.time)}`}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-destructive font-medium truncate">
              ↓ {nextSub.playerOut.number ? `#${nextSub.playerOut.number} ` : ""}{nextSub.playerOut.name}
            </span>
            <span className="text-muted-foreground text-xs">→</span>
            <span className="text-green-600 dark:text-green-400 font-medium truncate">
              ↑ {nextSub.playerIn.number ? `#${nextSub.playerIn.number} ` : ""}{nextSub.playerIn.name}
            </span>
          </div>
          {nextSub.positionSwap && (
            <p className="text-[10px] text-muted-foreground mt-1">
              + {nextSub.positionSwap.player.name} moves {nextSub.positionSwap.fromPosition} → {nextSub.positionSwap.toPosition}
            </p>
          )}
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant={autoSubPaused ? "default" : "outline"}
          className="h-8 text-xs gap-1 flex-1 min-w-0"
          onClick={onTogglePause}
        >
          {autoSubPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {autoSubPaused ? "Resume" : "Pause"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1 flex-1 min-w-0"
          onClick={onSkipNext}
          disabled={!nextSub || autoSubPaused}
          title="Skip the next substitution"
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1 flex-1 min-w-0"
          onClick={onExecuteNow}
          disabled={!nextSub || autoSubPaused}
          title="Execute the next substitution now"
        >
          <Zap className="h-3.5 w-3.5" />
          Now
        </Button>
      </div>

      {/* Secondary Actions */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 flex-1"
          onClick={onRegeneratePlan}
          title="Recalculate remaining plan"
        >
          <RefreshCw className="h-3 w-3" />
          Regenerate
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 flex-1"
          onClick={onEditPlan}
          title="Edit the substitution plan"
        >
          <Pencil className="h-3 w-3" />
          Edit Plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn("h-7 text-[10px] gap-1 flex-1", showLockPanel && "bg-accent")}
          onClick={() => setShowLockPanel(prev => !prev)}
          title="Lock players to prevent substitution"
        >
          <Lock className="h-3 w-3" />
          Lock ({lockedPlayerIds.size})
        </Button>
      </div>

      {/* Lock Player Panel */}
      {showLockPanel && (
        <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Locked players won't be subbed off
          </p>
          <div className="flex flex-wrap gap-1">
            {onPitchPlayers.map(player => {
              const isLocked = lockedPlayerIds.has(player.id);
              return (
                <Button
                  key={player.id}
                  size="sm"
                  variant={isLocked ? "default" : "outline"}
                  className={cn("h-7 text-[10px] gap-1 px-2", isLocked && "bg-amber-600 hover:bg-amber-700 text-white")}
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

      {/* Timeline Toggle */}
      <Button
        size="sm"
        variant="ghost"
        className="w-full h-7 text-[10px] gap-1"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide Timeline" : `Show Timeline (${executedSubs.length}/${autoSubPlan.length})`}
      </Button>

      {/* Sub Plan Timeline */}
      {expanded && (
        <ScrollArea className="max-h-[180px]">
          <div className="space-y-1">
            {autoSubPlan.map((sub, idx) => {
              const isDue = !sub.executed && sub.half === currentHalf && sub.time <= currentElapsedSeconds;
              const isNext = nextSub && sub === nextSub;
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-xs",
                    sub.executed 
                      ? "bg-muted/30 text-muted-foreground line-through" 
                      : isNext 
                        ? "bg-primary/10 border border-primary/30" 
                        : isDue 
                          ? "bg-amber-500/10 border border-amber-500/30"
                          : "bg-muted/20"
                  )}
                >
                  {/* Status icon */}
                  <div className="shrink-0">
                    {sub.executed ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : isNext ? (
                      <Clock className="h-3 w-3 text-primary" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-muted-foreground/40" />
                    )}
                  </div>

                  {/* Time */}
                  <Badge variant="secondary" className="font-mono text-[10px] h-5 shrink-0">
                    {sub.half === 2 && sub.time === 0 
                      ? "HT" 
                      : `${sub.half === 2 ? "2H " : ""}${formatTime(sub.time)}`}
                  </Badge>

                  {/* Players */}
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className="text-destructive truncate">
                      ↓{sub.playerOut.number ? `#${sub.playerOut.number}` : sub.playerOut.name}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-600 dark:text-green-400 truncate">
                      ↑{sub.playerIn.number ? `#${sub.playerIn.number}` : sub.playerIn.name}
                    </span>
                  </div>

                  {/* Lock indicator */}
                  {!sub.executed && lockedPlayerIds.has(sub.playerOut.id) && (
                    <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Cancel Plan */}
      <Button 
        variant="ghost" 
        size="sm" 
        className="w-full h-7 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onCancelPlan}
      >
        <X className="h-3 w-3 mr-1" />
        Cancel Plan
      </Button>
    </div>
  );
}
