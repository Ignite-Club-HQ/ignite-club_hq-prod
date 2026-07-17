import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { NetballCentrePassEntry, Quarter } from "./types";

interface CentrePassStatsPanelProps {
  homeLabel: string;
  awayLabel: string;
  log: NetballCentrePassEntry[] | undefined;
  currentQuarter: Quarter;
}

/**
 * Compact win-rate strip showing how often each side converted their centre
 * pass into a goal. Sits directly under the CentrePassIndicator so coaches
 * can spot a possession trend at a glance.
 *
 * Conversion = took the centre pass AND scored before possession flipped.
 * The indicator only renders once at least one centre pass has been logged
 * for the current quarter (zero noise pre-tipoff).
 */
const CentrePassStatsPanel = memo(function CentrePassStatsPanel({
  homeLabel,
  awayLabel,
  log,
  currentQuarter,
}: CentrePassStatsPanelProps) {
  const stats = useMemo(() => {
    const all = log ?? [];
    const calc = (entries: NetballCentrePassEntry[], side: "home" | "away") => {
      const taken = entries.filter((e) => e.side === side).length;
      const conv = entries.filter((e) => e.side === side && e.converted).length;
      return { taken, conv, pct: taken === 0 ? 0 : Math.round((conv / taken) * 100) };
    };
    return {
      qHome: calc(all.filter((e) => e.quarter === currentQuarter), "home"),
      qAway: calc(all.filter((e) => e.quarter === currentQuarter), "away"),
      gHome: calc(all, "home"),
      gAway: calc(all, "away"),
    };
  }, [log, currentQuarter]);

  if (stats.gHome.taken === 0 && stats.gAway.taken === 0) return null;

  return (
    <div
      className="flex items-center justify-between gap-2 px-2 py-1 border-b bg-background"
      role="group"
      aria-label="Centre-pass conversion stats"
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold whitespace-nowrap">
        CP win %
      </span>
      <div className="flex items-center gap-3 flex-1 justify-center text-[10px] tabular-nums">
        <SideStat
          label={homeLabel}
          q={stats.qHome}
          g={stats.gHome}
          currentQuarter={currentQuarter}
        />
        <span className="h-3 w-px bg-border" aria-hidden />
        <SideStat
          label={awayLabel}
          q={stats.qAway}
          g={stats.gAway}
          currentQuarter={currentQuarter}
        />
      </div>
    </div>
  );
});

function SideStat({
  label,
  q,
  g,
  currentQuarter,
}: {
  label: string;
  q: { taken: number; conv: number; pct: number };
  g: { taken: number; conv: number; pct: number };
  currentQuarter: Quarter;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="font-semibold uppercase truncate max-w-[70px]">{label}</span>
      <span
        className={cn(
          "px-1.5 py-0.5 rounded font-bold",
          q.pct >= 60
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : q.pct >= 40
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
        )}
        aria-label={`Q${currentQuarter} conversion`}
      >
        Q{currentQuarter} {q.conv}/{q.taken}
      </span>
      <span className="text-muted-foreground" aria-label="Game total">
        · G {g.conv}/{g.taken}
      </span>
    </div>
  );
}

export default CentrePassStatsPanel;
