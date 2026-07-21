import { memo, useMemo } from "react";
import { AlertTriangle, ShieldAlert, Battery } from "lucide-react";
import { cn } from "@/lib/utils";

interface WatchPlayer {
  id: string;
  name: string;
  position: unknown; // null = bench
  minutesPlayed?: number;
  isInjured?: boolean;
  isFouledOut?: boolean;
  /** Basketball only. */
  fouls?: number;
}

interface FoulFatigueWatchlistProps {
  sport: "basketball" | "netball";
  players: WatchPlayer[];
  currentQuarter: number;
  /** Total elapsed game seconds so far (sum across quarters). */
  totalElapsedSeconds: number;
  /** Configured minutes per quarter — used for the netball "no rest" check. */
  minutesPerQuarter: number;
  className?: string;
}

interface Alert {
  id: string;
  name: string;
  message: string;
  severity: "warn" | "danger";
  kind: "foul" | "fatigue";
}

/**
 * Auto-flag players the coach should be watching:
 *  - Basketball: 3 fouls in/before Q3 → warn, 4 fouls in Q4 → danger.
 *  - Netball: on-court for the full game so far with zero bench rest → fatigue warn.
 *
 * Hides itself when there are no alerts. Pure presentation — relies on the
 * fouls / minutesPlayed already maintained by the board hook.
 */
const FoulFatigueWatchlist = memo(function FoulFatigueWatchlist({
  sport,
  players,
  currentQuarter,
  totalElapsedSeconds,
  minutesPerQuarter,
  className,
}: FoulFatigueWatchlistProps) {
  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    const eligible = players.filter((p) => !p.isInjured && !p.isFouledOut);

    if (sport === "basketball") {
      for (const p of eligible) {
        const fouls = p.fouls ?? 0;
        if (currentQuarter >= 4 && fouls >= 4) {
          out.push({
            id: p.id,
            name: p.name,
            message: `${fouls} fouls — one away from fouling out`,
            severity: "danger",
            kind: "foul",
          });
        } else if (currentQuarter >= 3 && fouls >= 3) {
          out.push({
            id: p.id,
            name: p.name,
            message: `${fouls} fouls in Q${currentQuarter} — consider resting`,
            severity: "warn",
            kind: "foul",
          });
        }
      }
    }

    if (sport === "netball") {
      // Fatigue heuristic: on-court right now, played ≥ 80% of game so far,
      // and the game has been running for at least one full quarter.
      const oneQuarterSecs = minutesPerQuarter * 60;
      if (totalElapsedSeconds >= oneQuarterSecs) {
        for (const p of eligible) {
          if (p.position === null) continue;
          const ratio = (p.minutesPlayed ?? 0) / Math.max(1, totalElapsedSeconds);
          if (ratio >= 0.95 && totalElapsedSeconds >= oneQuarterSecs * 2) {
            out.push({
              id: p.id,
              name: p.name,
              message: `Played every minute — needs a breather`,
              severity: "danger",
              kind: "fatigue",
            });
          } else if (ratio >= 0.85) {
            out.push({
              id: p.id,
              name: p.name,
              message: `On for ${Math.round(ratio * 100)}% of the game`,
              severity: "warn",
              kind: "fatigue",
            });
          }
        }
      }
    }

    // Cap the visible list — three is plenty for a sideline glance.
    return out.slice(0, 3);
  }, [players, sport, currentQuarter, totalElapsedSeconds, minutesPerQuarter]);

  if (alerts.length === 0) return null;

  return (
    <div
      className={cn(
        "px-2 py-1.5 border-b bg-amber-500/5 dark:bg-amber-500/10 space-y-1",
        className
      )}
      role="region"
      aria-label="Watchlist"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
        <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        Watchlist
      </div>
      {alerts.map((a) => {
        const Icon = a.kind === "foul" ? ShieldAlert : Battery;
        const tone =
          a.severity === "danger"
            ? "text-destructive"
            : "text-amber-700 dark:text-amber-300";
        return (
          <div
            key={a.id}
            className="flex items-center gap-1.5 text-[11px] leading-tight"
          >
            <Icon className={cn("h-3 w-3 shrink-0", tone)} />
            <span className="font-semibold truncate">{a.name}</span>
            <span className="text-muted-foreground truncate">— {a.message}</span>
          </div>
        );
      })}
    </div>
  );
});

export default FoulFatigueWatchlist;
