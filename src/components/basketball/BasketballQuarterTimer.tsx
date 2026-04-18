import { useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Play, Pause, SkipForward, RotateCcw, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { BasketballTimerState, Quarter } from "./types";
import { formatTime } from "./basketballHelpers";
import { periodLabel, visiblePeriods } from "@/lib/periodTypes";

interface BasketballQuarterTimerProps {
  state: BasketballTimerState;
  onChange: (next: BasketballTimerState) => void;
  /** Fired each tick with the new elapsed seconds, current quarter, and the
   *  number of real seconds that elapsed since the previous tick (>= 1).
   *  Boards should use deltaSeconds to advance per-player minutes — using a
   *  hard-coded `1` causes drift after backgrounding. */
  onTick?: (elapsedSeconds: number, quarter: Quarter, deltaSeconds: number) => void;
  onQuarterEnd?: (quarter: Quarter) => void;
  /** Called when the user confirms a full reset. Parent should wipe per-player
   *  stats (fouls, points, FT counters, isFouledOut, minutesPlayed) + any
   *  cached cue refs so a fresh game starts cleanly. */
  onReset?: () => void;
  readOnly?: boolean;
}

export default function BasketballQuarterTimer({
  state,
  onChange,
  onTick,
  onQuarterEnd,
  onReset,
  readOnly = false,
}: BasketballQuarterTimerProps) {
  const intervalRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onQuarterEndRef = useRef(onQuarterEnd);
  onQuarterEndRef.current = onQuarterEnd;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  // Wall-clock driven tick to survive backgrounding.
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
    if (!window.confirm("Reset the game? This clears the timer, score, and player stats.")) return;
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
      homeTimeoutsRemaining: state.timeoutsPerHalf ?? 3,
      awayTimeoutsRemaining: state.timeoutsPerHalf ?? 3,
      timeoutsHalfTracked: 1,
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

  return (
    <div className="flex items-center justify-center gap-2 px-2 py-1 bg-card">
      {/* Period pill */}
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary tabular-nums shrink-0">
        {periodLabel(state.currentQuarter, state.periodType)}
      </span>

      {/* Timer clock */}
      <div
        className={cn(
          "tabular-nums font-mono font-extrabold text-2xl tracking-tight leading-none",
          lowTime && "text-destructive animate-pulse",
          state.isGameFinished && "text-muted-foreground"
        )}
        aria-live="polite"
      >
        {formatTime(remaining)}
      </div>

      {/* Primary play/pause + overflow */}
      {!readOnly && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant={state.isRunning ? "secondary" : "default"}
            className="h-8 w-8 rounded-full shadow-sm"
            onClick={toggle}
            disabled={state.isGameFinished}
            aria-label={state.isRunning ? "Pause" : "Start"}
          >
            {state.isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="More timer options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100000]">
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
    </div>
  );
}
