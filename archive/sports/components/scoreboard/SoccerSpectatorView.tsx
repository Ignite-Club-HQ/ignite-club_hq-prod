import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, WifiOff, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSpectatorFeedStale } from "@/components/scoreboard/spectatorTypes";
import type { Player } from "@/components/pitch/types";

/**
 * Lightweight read-only soccer pitch view for spectators.
 *
 * Driven entirely by the projected `active_games` payload — no local state
 * machine, no localStorage, no sync writes. Renders the running clock, the
 * current half, on-pitch players at their positions, and the bench list.
 * Mirrors the basketball / netball spectator views but tailored to the
 * simpler soccer data model (free-position players, two halves).
 */

interface SoccerTimerSnapshot {
  elapsedSeconds?: number;
  isRunning?: boolean;
  currentHalf?: number;
  minutesPerHalf?: number;
  lastUpdateTime?: number;
}

interface SoccerPitchSnapshot {
  players?: Player[];
}

interface SoccerSpectatorViewProps {
  teamName: string;
  board: SoccerPitchSnapshot;
  timer: SoccerTimerSnapshot;
  receivedAt: number;
  onClose: () => void;
}

const formatClock = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function SoccerSpectatorView({
  teamName,
  board,
  timer,
  receivedAt,
  onClose,
}: SoccerSpectatorViewProps) {
  const players = (board.players ?? []) as Player[];
  const minutesPerHalf = timer.minutesPerHalf ?? 10;
  const halfSeconds = minutesPerHalf * 60;
  const currentHalf = timer.currentHalf ?? 1;
  const isRunning = !!timer.isRunning;

  // Tick once a second so the clock advances smoothly and "feed stale" flips.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Project the live elapsed time off the last server tick so the clock
  // doesn't freeze between 10s syncs.
  const projectedElapsed = useMemo(() => {
    const baseline = timer.elapsedSeconds ?? 0;
    if (!isRunning || !timer.lastUpdateTime) return baseline;
    const drift = Math.max(0, Math.floor((now - timer.lastUpdateTime) / 1000));
    return Math.min(baseline + drift, halfSeconds);
  }, [isRunning, timer.lastUpdateTime, timer.elapsedSeconds, now, halfSeconds]);

  const remaining = Math.max(0, halfSeconds - projectedElapsed);
  const onPitch = players.filter((p) => p.position);
  const bench = players.filter((p) => !p.position);
  const stale = isSpectatorFeedStale(receivedAt, now);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between gap-2 p-2 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="font-bold text-sm truncate">{teamName}</h1>
          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Eye className="h-3 w-3" />
            Watching live · Soccer
            {stale && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-destructive">
                <WifiOff className="h-3 w-3" />
                paused
              </span>
            )}
          </p>
        </div>
        <div className="w-9" />
      </header>

      {/* Clock */}
      <div className="flex items-center justify-center gap-3 px-3 py-2 border-b bg-muted/30">
        <div className="text-3xl font-bold tabular-nums">{formatClock(remaining)}</div>
        <div className="flex flex-col items-start text-[11px] leading-tight">
          <span className="font-semibold">Half {currentHalf}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            {isRunning ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {isRunning ? "Running" : "Paused"}
          </span>
        </div>
      </div>

      {/* Pitch */}
      <div className="flex-1 overflow-hidden p-3">
        <div className="relative w-full h-full max-h-full mx-auto rounded-lg overflow-hidden border bg-[hsl(var(--primary)/0.08)]">
          {/* Pitch markings */}
          <div className="absolute inset-2 border-2 border-foreground/30 rounded-md" />
          <div className="absolute left-2 right-2 top-1/2 -translate-y-px h-px bg-foreground/30" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border-2 border-foreground/30 rounded-full" />

          {/* On-pitch players */}
          {onPitch.map((p) => (
            <div
              key={p.id}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2",
                "flex flex-col items-center gap-0.5 pointer-events-none",
              )}
              style={{
                left: `${p.position!.x}%`,
                top: `${p.position!.y}%`,
              }}
            >
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow">
                {p.number ?? p.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-[10px] font-medium text-foreground bg-background/80 px-1 rounded max-w-[80px] truncate">
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bench */}
      {bench.length > 0 && (
        <div className="border-t bg-card p-2">
          <div className="text-[11px] font-semibold text-muted-foreground mb-1">
            Bench ({bench.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {bench.map((p) => (
              <span
                key={p.id}
                className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground"
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
