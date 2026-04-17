import { useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, RotateCcw } from "lucide-react";
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
  readOnly?: boolean;
}

export default function BasketballQuarterTimer({
  state,
  onChange,
  onTick,
  onQuarterEnd,
  readOnly = false,
}: BasketballQuarterTimerProps) {
  const intervalRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onQuarterEndRef = useRef(onQuarterEnd);
  onQuarterEndRef.current = onQuarterEnd;

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
        // Credit the final partial second of the quarter to on-court players.
        const deltaToEnd = Math.max(0, quarterSeconds - cur.elapsedSeconds);
        if (deltaToEnd > 0) {
          onTickRef.current?.(quarterSeconds, cur.currentQuarter, deltaToEnd);
        }
        // In halves mode the visible periods are Q1 (=H1) and Q3 (=H2).
        // Skip Q2/Q4 so the game ends after H2 (== Q3 internally).
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
    if (state.currentQuarter >= 4) return;
    onChange({
      ...state,
      currentQuarter: (state.currentQuarter + 1) as Quarter,
      elapsedSeconds: 0,
      isRunning: false,
      lastUpdateTime: Date.now(),
    });
    onQuarterEndRef.current?.(state.currentQuarter);
  }, [state, onChange]);

  const reset = useCallback(() => {
    if (!window.confirm("Reset the game? This clears the timer and the score.")) return;
    onChange({
      ...state,
      currentQuarter: 1,
      elapsedSeconds: 0,
      isRunning: false,
      isGameFinished: false,
      homeScore: 0,
      awayScore: 0,
      scoreLog: [],
      lastUpdateTime: Date.now(),
    });
  }, [state, onChange]);

  const quarterSeconds = state.minutesPerQuarter * 60;
  const remaining = Math.max(0, quarterSeconds - state.elapsedSeconds);
  const lowTime = remaining <= 60 && state.isRunning;
  const periods = visiblePeriods(state.periodType);
  const isFinalPeriod = periods.indexOf(state.currentQuarter) === periods.length - 1;

  return (
    <div className="flex items-center gap-2 bg-card border rounded-full px-3 py-1.5 shadow-sm">
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary">
        {periodLabel(state.currentQuarter, state.periodType)}
      </span>
      <span
        className={cn(
          "tabular-nums font-mono font-bold text-sm min-w-[3rem] text-center",
          lowTime && "text-destructive animate-pulse"
        )}
      >
        {formatTime(remaining)}
      </span>
      {!readOnly && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={toggle}
            disabled={state.isGameFinished}
            aria-label={state.isRunning ? "Pause" : "Start"}
          >
            {state.isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={advanceQuarter}
            disabled={isFinalPeriod || state.isGameFinished}
            aria-label="Next period"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={reset}
            aria-label="Reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
