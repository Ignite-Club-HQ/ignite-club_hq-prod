import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Eye, Pencil, Repeat, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NetballPlayer,
  NetballSubEvent,
  Quarter,
  RotationMode,
} from "./types";
import { PeriodType, periodLabel, visiblePeriods } from "@/lib/periodTypes";
import { formatTime } from "./netballHelpers";

interface NetballRotationPreviewProps {
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  autoSubPlan: NetballSubEvent[];
  players: NetballPlayer[];
  minutesPerQuarter: number;
  periodType: PeriodType;
  /** Open the planner so the coach can drag/swap individual rotations. */
  onEditPlan: () => void;
  /** Open the read-only sub plan preview sheet. */
  onPreviewPlan: () => void;
  /** Toggle auto-subs on/off (passes the next mode). */
  onToggleAutoSub: (next: RotationMode) => void;
  readOnly?: boolean;
}

/**
 * Projected minutes per player if the current plan + starting lineup runs as-is.
 * Pure function — doesn't depend on a running clock so we can show it pre-game.
 */
function computeProjectedMinutes(
  players: NetballPlayer[],
  plan: NetballSubEvent[],
  minutesPerQuarter: number,
  periodType: PeriodType
): Map<string, number> {
  const periods = visiblePeriods(periodType);
  const quarterSeconds = minutesPerQuarter * 60;
  const totals = new Map<string, number>();
  for (const p of players) totals.set(p.id, 0);

  // Walk the game one period at a time, tracking which players are on court.
  let onCourtIds = new Set(
    players.filter((p) => p.position !== null).map((p) => p.id)
  );

  for (const q of periods) {
    // Subs in this quarter, sorted by time. Quarter-break subs (time=0) apply first.
    const subsThisQ = plan
      .filter((s) => s.quarter === q)
      .sort((a, b) => a.time - b.time);

    let cursor = 0;
    // Apply any time=0 (quarter-break) subs immediately at period start.
    while (cursor < subsThisQ.length && subsThisQ[cursor].time === 0) {
      const s = subsThisQ[cursor];
      onCourtIds.delete(s.playerOut.id);
      onCourtIds.add(s.playerIn.id);
      cursor++;
    }

    let elapsed = 0;
    while (cursor < subsThisQ.length) {
      const s = subsThisQ[cursor];
      const span = Math.max(0, Math.min(s.time, quarterSeconds) - elapsed);
      for (const id of onCourtIds) {
        totals.set(id, (totals.get(id) ?? 0) + span);
      }
      onCourtIds.delete(s.playerOut.id);
      onCourtIds.add(s.playerIn.id);
      elapsed = s.time;
      cursor++;
    }
    // Tail of the period.
    const tail = Math.max(0, quarterSeconds - elapsed);
    for (const id of onCourtIds) {
      totals.set(id, (totals.get(id) ?? 0) + tail);
    }
  }

  return totals;
}

export default function NetballRotationPreview({
  rotationMode,
  rotationIntervalMinutes,
  autoSubPlan,
  players,
  minutesPerQuarter,
  periodType,
  onEditPlan,
  onPreviewPlan,
  onToggleAutoSub,
  readOnly = false,
}: NetballRotationPreviewProps) {
  const autoSubActive = rotationMode !== "off";

  const projectedSeconds = useMemo(
    () =>
      autoSubActive
        ? computeProjectedMinutes(players, autoSubPlan, minutesPerQuarter, periodType)
        : new Map<string, number>(),
    [autoSubActive, players, autoSubPlan, minutesPerQuarter, periodType]
  );

  const groupedByQuarter = useMemo(() => {
    const map = new Map<Quarter, NetballSubEvent[]>();
    for (const sub of autoSubPlan) {
      const list = map.get(sub.quarter) ?? [];
      list.push(sub);
      map.set(sub.quarter, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time - b.time);
    return map;
  }, [autoSubPlan]);

  const lineupReady = players.filter((p) => p.position !== null).length >= 7;

  // ── Empty / off states ──────────────────────────────────────────
  if (!autoSubActive) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Repeat className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Auto-subs are off</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Plan player rotations before kickoff so the board can prompt you
              automatically during the game.
            </p>
          </div>
          {!readOnly && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => onToggleAutoSub("time-based")}
            >
              <Sparkles className="h-4 w-4" />
              Turn on auto-subs
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!lineupReady) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center space-y-2">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-sm font-semibold">Pick your starting 7 first</div>
          <p className="text-xs text-muted-foreground">
            Once your lineup is set, we'll generate a {rotationIntervalMinutes}-minute
            rotation plan you can preview here.
          </p>
        </div>
      </div>
    );
  }

  if (autoSubPlan.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No rotations scheduled — every player on court already has the
          minimum bench rest.
        </div>
      </div>
    );
  }

  // ── Active plan view: timeline + projected minutes ──────────────
  const sortedPlayersByMinutes = [...players].sort((a, b) => {
    const aMin = projectedSeconds.get(a.id) ?? 0;
    const bMin = projectedSeconds.get(b.id) ?? 0;
    return bMin - aMin;
  });
  const totalGameSeconds =
    visiblePeriods(periodType).length * minutesPerQuarter * 60;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
      {/* Action row */}
      {!readOnly && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onPreviewPlan}
          >
            <Eye className="h-3.5 w-3.5" />
            Quick preview
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={onEditPlan}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit rotations
          </Button>
        </div>
      )}

      {/* Timeline per quarter */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rotation timeline
          </h3>
          <span className="text-[10.5px] text-muted-foreground tabular-nums">
            {autoSubPlan.length} swap{autoSubPlan.length === 1 ? "" : "s"}
          </span>
        </div>

        {visiblePeriods(periodType).map((q) => {
          const subs = groupedByQuarter.get(q as Quarter) ?? [];
          return (
            <div
              key={q}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="px-3 py-1.5 bg-muted/40 flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wide">
                  {periodLabel(q as 1 | 2 | 3 | 4, periodType)}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {subs.length === 0 ? "no swaps" : `${subs.length} swap${subs.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {subs.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
                  No rotations planned this period.
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {subs.map((sub, idx) => (
                    <li
                      key={`${sub.quarter}-${sub.time}-${sub.playerOut.id}-${idx}`}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] h-5 px-1.5 tabular-nums shrink-0"
                      >
                        {sub.time === 0 ? "start" : formatTime(sub.time)}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 px-1.5 font-bold shrink-0"
                      >
                        {sub.position}
                      </Badge>
                      <div className="flex-1 min-w-0 text-[11.5px] leading-tight">
                        <div className="flex items-center gap-1 text-destructive">
                          <ArrowDown className="h-3 w-3 shrink-0" />
                          <span className="truncate font-medium">
                            {sub.playerOut.number ? `#${sub.playerOut.number} ` : ""}
                            {sub.playerOut.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <ArrowUp className="h-3 w-3 shrink-0" />
                          <span className="truncate font-medium">
                            {sub.playerIn.number ? `#${sub.playerIn.number} ` : ""}
                            {sub.playerIn.name}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {/* Projected minutes per player */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Projected minutes
          </h3>
          <span className="text-[10.5px] text-muted-foreground tabular-nums">
            Game · {Math.round(totalGameSeconds / 60)}m
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
          {sortedPlayersByMinutes.map((p) => {
            const secs = projectedSeconds.get(p.id) ?? 0;
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            const pct = totalGameSeconds > 0 ? (secs / totalGameSeconds) * 100 : 0;
            const isStarter = p.position !== null;
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    isStarter ? "bg-primary" : "bg-muted-foreground/40"
                  )}
                  aria-hidden
                />
                <span className="truncate font-medium flex-1 min-w-0">
                  {p.number ? `#${p.number} ` : ""}
                  {p.name}
                </span>
                {isStarter && p.position && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-bold shrink-0">
                    {p.position}
                  </Badge>
                )}
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 75 ? "bg-primary" : pct >= 25 ? "bg-primary/70" : "bg-muted-foreground/40"
                    )}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <span className="font-mono tabular-nums text-[11px] text-muted-foreground shrink-0 w-12 text-right">
                  {m}m {s.toString().padStart(2, "0")}s
                </span>
              </div>
            );
          })}
        </div>
        <p className="px-1 text-[10px] text-muted-foreground leading-snug">
          Estimates assume the plan runs exactly as scheduled. Real minutes will
          differ if you skip, pause, or manually swap during the game.
        </p>
      </section>
    </div>
  );
}
