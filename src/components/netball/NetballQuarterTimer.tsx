import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, RotateCcw } from "lucide-react";
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
}

export default function NetballQuarterTimer({
  state,
  onChange,
  onTick,
  onQuarterEnd,
  onReset,
  readOnly = false,
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
        // Quarter ended
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
    // We intentionally only re-subscribe when running flips or quarter changes.
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
    // Notify the parent so it can wipe per-player stats + cued sub IDs.
    onResetRef.current?.();
  }, [state, onChange]);

  const quarterSeconds = state.minutesPerQuarter * 60;
  const remaining = Math.max(0, quarterSeconds - state.elapsedSeconds);
  const lowTime = remaining <= 60 && state.isRunning;
  const periods = visiblePeriods(state.periodType);
  const isFinalPeriod = periods.indexOf(state.currentQuarter) === periods.length - 1;

  return (
    <div className="flex items-center gap-2 bg-card border rounded-full px-3 py-1.5 shadow-sm">
      <span
        className={cn(
          "px-2 py-0.5 rounded-full text-xs font-bold",
          "bg-primary/10 text-primary"
        )}
      >
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
