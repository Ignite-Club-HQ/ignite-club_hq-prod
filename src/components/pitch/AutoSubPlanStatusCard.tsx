import { cn } from "@/lib/utils";

export interface AutoSubPlanStatusCardProps {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}

export default function AutoSubPlanStatusCard({
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: AutoSubPlanStatusCardProps) {
  const hasShortShifts = shortShifts > 0;
  const hasSpread = spreadMin > 6;
  const needsAdjustment = hasHalftimeClash || hasShortShifts || hasSpread;

  return (
    <div
      data-testid="autosub-plan-status"
      data-needs-adjustment={needsAdjustment ? "true" : "false"}
      className={cn(
        "rounded-lg border p-3 mb-2",
        needsAdjustment
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-emerald-500/40 bg-emerald-500/5",
      )}
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Subs</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{totalSubs}</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Minutes diff</div>
          <div className={cn("text-sm font-bold tabular-nums", hasSpread ? "text-amber-600" : "text-foreground")}>
            {spreadMin.toFixed(1)}m
          </div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Very short turns</div>
          <div className={cn("text-sm font-bold tabular-nums", hasShortShifts ? "text-amber-600" : "text-emerald-600")}>
            {shortShifts}
          </div>
        </div>
      </div>
    </div>
  );
}
