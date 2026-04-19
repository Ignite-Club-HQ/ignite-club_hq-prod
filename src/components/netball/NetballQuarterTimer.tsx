import { useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Play, Pause, SkipForward, RotateCcw, MoreVertical, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetballTimerState, Quarter } from "./types";
import { formatTime } from "./netballHelpers";
import { periodLabel, visiblePeriods } from "@/lib/periodTypes";

interface NetballQuarterTimerProps {
  state: NetballTimerState;
  onChange: (next: NetballTimerState) => void;
  /** Called every tick while running. `deltaSeconds` is the real elapsed
   *  seconds since the previous tick (>= 1) — used to credit on-court players
   *  accurately even when the app was backgrounded. */
  onTick?: (elapsedSeconds: number, quarter: Quarter, deltaSeconds: number) => void;
  /** Called when a quarter ends naturally. */
  onQuarterEnd?: (quarter: Quarter) => void;
  /** Called when the user confirms a full reset — parent should wipe per-player
   *  stats + any cached cue/sub state so a fresh game starts cleanly. */
  onReset?: () => void;
  readOnly?: boolean;
  /** Inline rendering for the floating HUD control slot (no card wrapper). */
  compact?: boolean;
  /** Opens the auto-sub plan panel (preview, execute, skip). */
  onOpenAutoSubPlan?: () => void;
  /** Whether an auto-sub plan currently exists — controls menu label. */
  hasAutoSubPlan?: boolean;
}

export default function NetballQuarterTimer({
  state,
  onChange,
  onTick,
  onQuarterEnd,
  onReset,
  readOnly = false,
  compact = false,
  onOpenAutoSubPlan,
  hasAutoSubPlan = false,
}: NetballQuarterTimerProps) {
  const intervalRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onQuarterEndRef = useRef(onQuarterEnd);
  onQuarterEndRef.current = onQuarterEnd;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  // Drive the timer using wall-clock to survive backgrounding.
  useEffect(() => {
    if (!state.isRunning || state.isGameFinished) return;

    const tick = () => {
      const cur = stateRef.current;
      const elapsedSinceUpdate = Math.max(
        1,
        Math.floor((Date.now() - cur.lastUpdateTime) / 1000)
      );
      const newElapsed = cur.elapsedSeconds + elapsedSinceUpdate;
      const quarterSeconds = cur.minutesPerQuarter * 60;

      if (newElapsed >= quarterSeconds) {
        const endingQuarter = cur.currentQuarter;
        const deltaToEnd = Math.max(0, quarterSeconds - cur.elapsedSeconds);
        if (deltaToEnd > 0) {
          onTickRef.current?.(quarterSeconds, cur.currentQuarter, deltaToEnd);
        }
        const periods = visiblePeriods(cur.periodType);
        const idx = periods.indexOf(cur.currentQuarter);
        const isFinalPeriod = idx === periods.length - 1;
        const nextSlot = (periods[idx + 1] ?? null) as Quarter | null;
        if (isFinalPeriod) {
          onChange({
            ...cur,
            elapsedSeconds: quarterSeconds,
            isRunning: false,
            isGameFinished: true,
            lastUpdateTime: Date.now(),
          });
        } else {
          onChange({
            ...cur,
            currentQuarter: nextSlot ?? ((cur.currentQuarter + 1) as Quarter),
            elapsedSeconds: 0,
            isRunning: false,
            lastUpdateTime: Date.now(),
          });
        }
        onQuarterEndRef.current?.(endingQuarter);
      } else {
        onChange({ ...cur, elapsedSeconds: newElapsed, lastUpdateTime: Date.now() });
        onTickRef.current?.(newElapsed, cur.currentQuarter, elapsedSinceUpdate);
      }
    };

    intervalRef.current = window.setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRunning, state.currentQuarter, state.isGameFinished]);

  const toggle = useCallback(() => {
    onChange({ ...state, isRunning: !state.isRunning, lastUpdateTime: Date.now() });
  }, [state, onChange]);

  const advanceQuarter = useCallback(() => {
    const periods = visiblePeriods(state.periodType);
    const idx = periods.indexOf(state.currentQuarter);
    const next = periods[idx + 1];
    if (!next) return;
    onChange({
      ...state,
      currentQuarter: next,
      elapsedSeconds: 0,
      isRunning: false,
      lastUpdateTime: Date.now(),
    });
    onQuarterEndRef.current?.(state.currentQuarter);
  }, [state, onChange]);

  const reset = useCallback(() => {
    if (!window.confirm("Reset the game? This clears the timer, score, sub log, and player stats.")) return;
    onChange({
      ...state,
      currentQuarter: 1,
      elapsedSeconds: 0,
      isRunning: false,
      isGameFinished: false,
      homeScore: 0,
      awayScore: 0,
      scoreLog: [],
      subLog: [],
      centrePassLog: [],
      centrePass: "home",
      mvpPlayerId: null,
      lastUpdateTime: Date.now(),
    });
    onResetRef.current?.();
  }, [state, onChange]);

  const quarterSeconds = state.minutesPerQuarter * 60;
  const remaining = Math.max(0, quarterSeconds - state.elapsedSeconds);
  const lowTime = remaining <= 60 && state.isRunning;
  const periods = visiblePeriods(state.periodType);
  const isFinalPeriod = periods.indexOf(state.currentQuarter) === periods.length - 1;

  const inner = (
    <>
      <span
        className={cn(
          "rounded-full font-bold bg-primary/10 text-primary tabular-nums shrink-0",
          compact ? "px-2 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        )}
      >
        {periodLabel(state.currentQuarter, state.periodType)}
      </span>

      <div
        className={cn(
          "tabular-nums font-mono font-extrabold tracking-tight leading-none shrink-0",
          compact ? "text-base px-0.5" : "text-2xl",
          lowTime && "text-destructive animate-pulse",
          state.isGameFinished && "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {formatTime(remaining)}
      </div>

      {!readOnly && (
        <div className={cn("flex items-center shrink-0", compact ? "gap-3 ml-1" : "gap-2")}>
          <Button
            size="icon"
            variant={state.isRunning ? "secondary" : "default"}
            className={cn(
              "rounded-full shadow-md",
              compact ? "h-10 w-10 min-h-0 min-w-0" : "h-10 w-10",
            )}
            onClick={toggle}
            disabled={state.isGameFinished}
            aria-label={state.isRunning ? "Pause" : "Start"}
          >
            {state.isRunning ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn(compact ? "h-8 w-8 min-h-0 min-w-0" : "h-8 w-8")}
                aria-label="More timer options"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100000]">
              {onOpenAutoSubPlan && (
                <>
                  <DropdownMenuItem onClick={onOpenAutoSubPlan}>
                    <Repeat className="h-4 w-4 mr-2" />
                    {hasAutoSubPlan ? "Auto-sub plan" : "Set up auto-subs"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={advanceQuarter}
                disabled={isFinalPeriod || state.isGameFinished}
              >
                <SkipForward className="h-4 w-4 mr-2" />
                Next period
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={reset} className="text-destructive focus:text-destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset game
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  );

  if (compact) {
    return <div className="flex items-center gap-2 shrink-0">{inner}</div>;
  }

  return (
    <div className="flex items-center justify-center gap-2 px-2 py-1 bg-card">
      {inner}
    </div>
  );
}
