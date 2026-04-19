import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Pause, Play, Lock, Unlock, X, Check, Pencil, Clock,
  ChevronDown, ChevronUp, SkipForward, RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { periodLabel as periodLabelFn, type PeriodType } from "@/lib/periodTypes";

/**
 * Sport-agnostic auto-sub control panel for quarter-based games (basketball + netball).
 * Mirrors the soccer AutoSubControlPanel UX but works on `quarter`+`time` schedules.
 *
 * Generic over the sub event shape so each sport keeps its own typed payload.
 */
export interface QuarterSubLike {
  quarter: 1 | 2 | 3 | 4;
  time: number;
  playerOut: { id: string; name: string; number?: number };
  playerIn: { id: string; name: string; number?: number };
  position: string;
  executed?: boolean;
  skipped?: boolean;
}

export interface OnCourtPlayerLike {
  id: string;
  name: string;
  number?: number;
  position: string | null;
}

interface QuarterAutoSubControlPanelProps<S extends QuarterSubLike> {
  open: boolean;
  onClose: () => void;
  autoSubPlan: S[];
  autoSubPaused: boolean;
  onPlayers: OnCourtPlayerLike[];
  lockedPlayerIds: Set<string>;
  currentQuarter: 1 | 2 | 3 | 4;
  currentElapsedSeconds: number;
  minutesPerQuarter: number;
  periodType?: PeriodType;
  onTogglePause: () => void;
  onCancelPlan: () => void;
  onSkipNext: () => void;
  onExecuteNow: () => void;
  onRegeneratePlan: () => void;
  onToggleLockPlayer: (playerId: string) => void;
  /** Optional editor entry-point (e.g. open the lineup planner). */
  onEditPlan?: () => void;
  /**
   * Pre-game preview mode: hides every live-game action (Tap to execute,
   * Pause, Skip, Lock, Regenerate, Cancel Plan) and shows the timeline only.
   * Coaches use it to review the planned rotation before tip-off.
   */
  previewMode?: boolean;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function QuarterAutoSubControlPanel<S extends QuarterSubLike>({
  open,
  onClose,
  autoSubPlan,
  autoSubPaused,
  onPlayers,
  lockedPlayerIds,
  currentQuarter,
  currentElapsedSeconds,
  periodType,
  onTogglePause,
  onCancelPlan,
  onSkipNext,
  onExecuteNow,
  onRegeneratePlan,
  onToggleLockPlayer,
  onEditPlan,
  previewMode = false,
}: QuarterAutoSubControlPanelProps<S>) {
  // In preview (pre-game) mode the timeline is the whole point — open it by default.
  const [showTimeline, setShowTimeline] = useState(previewMode);
  const [showLockPanel, setShowLockPanel] = useState(false);
  const swipeRef = useRef<{ startY: number } | null>(null);

  const remainingSubs = useMemo(
    () => autoSubPlan.filter((s) => !s.executed && !s.skipped),
    [autoSubPlan]
  );
  const executedSubs = useMemo(
    () => autoSubPlan.filter((s) => s.executed),
    [autoSubPlan]
  );

  // Next chronologically (across quarters). Quarter-break subs have time=0.
  const nextSub = useMemo(() => {
    return (
      remainingSubs.find(
        (s) => s.quarter === currentQuarter && s.time >= currentElapsedSeconds
      ) ||
      remainingSubs.find((s) => s.quarter > currentQuarter) ||
      remainingSubs[0]
    );
  }, [remainingSubs, currentQuarter, currentElapsedSeconds]);

  // All subs scheduled at the same quarter+time as the next sub (batch).
  const nextBatchSubs = useMemo(() => {
    if (!nextSub) return [];
    return remainingSubs.filter(
      (s) => s.quarter === nextSub.quarter && s.time === nextSub.time
    );
  }, [remainingSubs, nextSub]);

  const periodTag = (q: 1 | 2 | 3 | 4) => periodLabelFn(q, periodType);

  if (!open) return null;

  // Group plan by quarter+time for the mini-timeline.
  const periodsToShow: (1 | 2 | 3 | 4)[] = periodType === "halves" ? [1, 3] : [1, 2, 3, 4];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative z-[9999] w-full max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "calc(100dvh - 1rem - env(safe-area-inset-bottom))", WebkitOverflowScrolling: "touch" }}
      >
        {/* Swipe-down handle (mobile) */}
        <div
          className="flex justify-center pt-3 pb-1 sm:hidden cursor-grab touch-none"
          onTouchStart={(e) => {
            swipeRef.current = { startY: e.touches[0].clientY };
          }}
          onTouchEnd={(e) => {
            if (!swipeRef.current) return;
            const deltaY = e.changedTouches[0].clientY - swipeRef.current.startY;
            swipeRef.current = null;
            if (deltaY > 60) onClose();
          }}
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>

        <div className="p-4 pb-8 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {previewMode ? "Sub Plan Preview" : "Auto Substitutions"}
            </h3>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Next Sub Card */}
          {nextBatchSubs.length > 0 ? (
            previewMode ? (
              // Pre-game: read-only "First sub" preview card. No tap handler.
              <div className="w-full rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    First Sub
                  </span>
                  <Badge variant="secondary" className="font-mono text-xs h-6 px-2">
                    {periodTag(nextSub!.quarter)}
                    {nextSub!.time === 0 ? " start" : ` ${formatTime(nextSub!.time)}`}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {nextBatchSubs.map((sub, idx) => (
                    <div key={idx}>
                      {nextBatchSubs.length > 1 && (
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                          Sub {idx + 1} · {sub.position}
                        </div>
                      )}
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-base">
                          <span className="text-[10px] uppercase font-bold text-destructive w-7 shrink-0">OUT</span>
                          <span className="text-destructive font-semibold truncate">
                            {sub.playerOut.number ? `#${sub.playerOut.number} ` : ""}
                            {sub.playerOut.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-base">
                          <span className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 w-7 shrink-0">IN</span>
                          <span className="text-green-600 dark:text-green-400 font-semibold truncate">
                            {sub.playerIn.number ? `#${sub.playerIn.number} ` : ""}
                            {sub.playerIn.name}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
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
                    {nextBatchSubs.length > 1 ? `Next ${nextBatchSubs.length} Subs` : "Next Sub"}
                    {!autoSubPaused && (
                      <span className="text-primary font-semibold"> · Tap to execute</span>
                    )}
                  </span>
                  <Badge variant="secondary" className="font-mono text-xs h-6 px-2">
                    {periodTag(nextSub!.quarter)}
                    {nextSub!.time === 0 ? " start" : ` ${formatTime(nextSub!.time)}`}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {nextBatchSubs.map((sub, idx) => (
                    <div key={idx}>
                      {nextBatchSubs.length > 1 && (
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                          Sub {idx + 1} · {sub.position}
                        </div>
                      )}
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-base">
                          <span className="text-[10px] uppercase font-bold text-destructive w-7 shrink-0">
                            OUT
                          </span>
                          <span className="text-destructive font-semibold truncate">
                            {sub.playerOut.number ? `#${sub.playerOut.number} ` : ""}
                            {sub.playerOut.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-base">
                          <span className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 w-7 shrink-0">
                            IN
                          </span>
                          <span className="text-green-600 dark:text-green-400 font-semibold truncate">
                            {sub.playerIn.number ? `#${sub.playerIn.number} ` : ""}
                            {sub.playerIn.name}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            )
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              No upcoming auto-subs
            </div>
          )}

          {/* Pause / Skip */}
          {remainingSubs.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={autoSubPaused ? "default" : "outline"}
                className="h-11 gap-1.5"
                onClick={onTogglePause}
              >
                {autoSubPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {autoSubPaused ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-1.5"
                onClick={onSkipNext}
                disabled={!nextSub}
              >
                <SkipForward className="h-4 w-4" />
                Skip Next
              </Button>
            </div>
          )}

          {/* Lock Players */}
          <div className="grid grid-cols-1 gap-2">
            {remainingSubs.length > 0 && (
              <Button
                variant="outline"
                className={cn("h-11 gap-2", showLockPanel && "bg-accent")}
                onClick={() => setShowLockPanel((p) => !p)}
              >
                <Lock className="h-4 w-4" />
                Lock ({lockedPlayerIds.size})
              </Button>
            )}
          </div>

          {showLockPanel && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">
                Locked players won't be subbed off automatically
              </p>
              <div className="flex flex-wrap gap-1.5">
                {onPlayers.map((player) => {
                  const isLocked = lockedPlayerIds.has(player.id);
                  return (
                    <Button
                      key={player.id}
                      size="sm"
                      variant={isLocked ? "default" : "outline"}
                      className={cn(
                        "h-8 text-xs gap-1 px-2.5",
                        isLocked && "bg-amber-600 hover:bg-amber-700 text-white"
                      )}
                      onClick={() => onToggleLockPlayer(player.id)}
                    >
                      {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      {player.number ? `#${player.number} ` : ""}
                      {player.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tertiary: Regenerate / Edit / Timeline */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={onRegeneratePlan}
            >
              <RefreshCcw className="h-4 w-4" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              className={cn("h-11 gap-2", showTimeline && "bg-accent")}
              onClick={() => setShowTimeline((p) => !p)}
            >
              {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Timeline ({executedSubs.length}/{autoSubPlan.length})
            </Button>
          </div>

          {onEditPlan && (
            <Button
              variant="outline"
              className="w-full h-11 gap-2"
              onClick={() => {
                onEditPlan();
                onClose();
              }}
            >
              <Pencil className="h-4 w-4" />
              Open Lineup Planner
            </Button>
          )}

          {/* Timeline */}
          {showTimeline && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div>
                <div className="divide-y divide-border">
                  {periodsToShow.map((q) => {
                    // For halves, group Q1+Q2 under H1, Q3+Q4 under H2
                    const includedQuarters: (1 | 2 | 3 | 4)[] =
                      periodType === "halves"
                        ? q === 1
                          ? [1, 2]
                          : [3, 4]
                        : [q];

                    const periodSubs = autoSubPlan
                      .map((sub, idx) => ({ sub, idx }))
                      .filter(({ sub }) => includedQuarters.includes(sub.quarter));

                    if (periodSubs.length === 0) return null;

                    const groups: { key: string; quarter: 1 | 2 | 3 | 4; time: number; items: { sub: S; idx: number }[] }[] = [];
                    periodSubs.forEach(({ sub, idx }) => {
                      const k = `${sub.quarter}-${sub.time}`;
                      const existing = groups.find((g) => g.key === k);
                      if (existing) {
                        existing.items.push({ sub, idx });
                      } else {
                        groups.push({ key: k, quarter: sub.quarter, time: sub.time, items: [{ sub, idx }] });
                      }
                    });
                    groups.sort(
                      (a, b) => a.quarter - b.quarter || a.time - b.time
                    );

                    return (
                      <div key={`p-${q}`}>
                        <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold text-muted-foreground">
                          {periodTag(q)}
                        </div>
                        {groups.map((group) => {
                          const timeLabel =
                            group.time === 0 ? "Start" : formatTime(group.time);
                          const allExecuted = group.items.every(({ sub }) => sub.executed);
                          const allSkipped = group.items.every(({ sub }) => sub.skipped);
                          const anyNext = group.items.some(({ sub }) => nextSub && sub === nextSub);
                          const anyDue = group.items.some(
                            ({ sub }) =>
                              !sub.executed &&
                              !sub.skipped &&
                              sub.quarter === currentQuarter &&
                              sub.time <= currentElapsedSeconds
                          );

                          return (
                            <div
                              key={group.key}
                              className={cn(
                                "flex gap-2.5 px-3 py-2",
                                allExecuted
                                  ? allSkipped
                                    ? "bg-muted/10 opacity-60"
                                    : "bg-muted/20"
                                  : anyNext
                                    ? "bg-primary/10"
                                    : anyDue
                                      ? "bg-amber-500/10"
                                      : ""
                              )}
                            >
                              <div className="flex flex-col items-center pt-0.5 shrink-0 w-16">
                                <div className="shrink-0 mb-1">
                                  {allExecuted ? (
                                    allSkipped ? (
                                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5 text-green-500" />
                                    )
                                  ) : anyNext ? (
                                    <Clock className="h-3.5 w-3.5 text-primary" />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30" />
                                  )}
                                </div>
                                <Badge variant="secondary" className="font-mono text-[10px] h-5">
                                  {periodTag(group.quarter)} {timeLabel}
                                </Badge>
                              </div>
                              <div className="flex-1 space-y-1 min-w-0">
                                {group.items.map(({ sub, idx }) => (
                                  <div
                                    key={idx}
                                    className={cn(
                                      "flex items-center gap-1 text-sm",
                                      sub.skipped && "text-muted-foreground/50 line-through",
                                      sub.executed && !sub.skipped && "text-muted-foreground"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "truncate",
                                        sub.skipped
                                          ? "text-muted-foreground/50"
                                          : "text-destructive"
                                      )}
                                    >
                                      {sub.playerOut.name}
                                    </span>
                                    <span className="text-muted-foreground text-xs">→</span>
                                    <span
                                      className={cn(
                                        "truncate",
                                        sub.skipped
                                          ? "text-muted-foreground/50"
                                          : "text-green-600 dark:text-green-400"
                                      )}
                                    >
                                      {sub.playerIn.name}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] h-4 px-1 shrink-0"
                                    >
                                      {sub.position}
                                    </Badge>
                                    {sub.skipped && (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] h-4 px-1 text-muted-foreground shrink-0"
                                      >
                                        Skipped
                                      </Badge>
                                    )}
                                    {!sub.executed && lockedPlayerIds.has(sub.playerOut.id) && (
                                      <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Cancel Plan */}
          <Button
            variant="ghost"
            className="w-full h-11 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              onCancelPlan();
              onClose();
            }}
          >
            <X className="h-4 w-4 mr-1.5" />
            Cancel Plan
          </Button>
        </div>
      </div>
    </div>
  );
}
