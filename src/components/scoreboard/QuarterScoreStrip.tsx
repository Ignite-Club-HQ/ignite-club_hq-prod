import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

interface ScoreLogEntry {
  side: "home" | "away";
  points: number;
  quarter: number;
}

interface QuarterScoreStripProps {
  scoreLog: ScoreLogEntry[] | undefined;
  totalQuarters?: number;
  currentQuarter: number;
  className?: string;
}

/**
 * Compact per-quarter score breakdown derived from the scoreboard's append-only
 * scoreLog. Pure presentation — no scoring logic here.
 *
 * Shape:
 *   |  Q1  |  Q2  |  Q3  |  Q4  | Tot |
 *   |  6-4 |  8-9 |  -   |  -   |14-13|
 */
const QuarterScoreStrip = memo(function QuarterScoreStrip({
  scoreLog,
  totalQuarters = 4,
  currentQuarter,
  className,
}: QuarterScoreStripProps) {
  const breakdown = useMemo(() => {
    const rows: { home: number; away: number }[] = Array.from(
      { length: totalQuarters },
      () => ({ home: 0, away: 0 })
    );
    for (const entry of scoreLog ?? []) {
      const idx = entry.quarter - 1;
      if (idx < 0 || idx >= totalQuarters) continue;
      rows[idx][entry.side] += entry.points;
    }
    const totalHome = rows.reduce((sum, r) => sum + r.home, 0);
    const totalAway = rows.reduce((sum, r) => sum + r.away, 0);
    return { rows, totalHome, totalAway };
  }, [scoreLog, totalQuarters]);

  return (
    <div
      className={cn(
        "flex items-stretch border-b bg-muted/30 text-[10px]",
        className
      )}
      role="table"
      aria-label="Score by quarter"
    >
      {breakdown.rows.map((row, idx) => {
        const q = idx + 1;
        const hasScore = row.home + row.away > 0;
        const isCurrent = q === currentQuarter;
        return (
          <div
            key={q}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-1 border-r last:border-r-0",
              isCurrent && "bg-primary/10"
            )}
          >
            <span
              className={cn(
                "uppercase font-semibold tracking-wide",
                isCurrent ? "text-primary" : "text-muted-foreground"
              )}
            >
              Q{q}
            </span>
            <span className="tabular-nums font-mono font-bold text-foreground">
              {hasScore ? `${row.home}-${row.away}` : "—"}
            </span>
          </div>
        );
      })}
      <div className="flex-1 flex flex-col items-center justify-center py-1 bg-card">
        <span className="uppercase font-semibold tracking-wide text-muted-foreground">
          Total
        </span>
        <span className="tabular-nums font-mono font-bold text-foreground">
          {breakdown.totalHome}-{breakdown.totalAway}
        </span>
      </div>
    </div>
  );
});

export default QuarterScoreStrip;
