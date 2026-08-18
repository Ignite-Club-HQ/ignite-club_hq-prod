import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CompetitionFixtureRow } from "./types";

interface FixtureRoundSectionProps {
  label: string;
  items: CompetitionFixtureRow[];
  renderMatch: (match: CompetitionFixtureRow) => ReactNode;
}

export function FixtureRoundSection({
  label,
  items,
  renderMatch,
}: FixtureRoundSectionProps) {
  const [open, setOpen] = useState(true);
  const dateRange = useMemo(() => {
    const dates = items
      .map((match) => match.scheduled_at ? new Date(match.scheduled_at) : null)
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime());
    if (dates.length === 0) return null;
    const first = format(dates[0], "EEE d MMM");
    const last = format(dates[dates.length - 1], "EEE d MMM");
    return first === last ? first : `${first} – ${last}`;
  }, [items]);
  const completed = items.filter((match) => match.status === "completed").length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger className="w-full group sticky top-0 z-10 bg-background -mx-1 px-1 py-2 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0 text-left">
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-extrabold tracking-wider text-foreground uppercase leading-tight">{label}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums leading-tight mt-0.5">
              {items.length} {items.length === 1 ? "Match" : "Matches"}{dateRange ? ` • ${dateRange}` : ""}
            </div>
          </div>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium tabular-nums ${completed === items.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {completed}/{items.length} Complete
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5">
        {items.map(renderMatch)}
      </CollapsibleContent>
    </Collapsible>
  );
}
