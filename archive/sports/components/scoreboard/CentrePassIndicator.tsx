import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CentrePassIndicatorProps {
  homeLabel: string;
  awayLabel: string;
  /** Which side has the next centre pass. */
  side: "home" | "away";
  readOnly?: boolean;
  onSwap: () => void;
}

/**
 * Netball centre-pass indicator.
 *
 * In netball the centre pass alternates after every goal regardless of who
 * scored. Coaches frequently lose track in junior games — this little chip
 * sits under the scoreboard and:
 *   - shows whose throw it is at a glance
 *   - lets the coach manually flip it (e.g. ref reset, or fix a missed flip)
 *
 * The board's score handler calls `onScore` and is expected to flip the
 * side via `setCentrePass` after each goal — see NetballBoard.
 */
const CentrePassIndicator = memo(function CentrePassIndicator({
  homeLabel,
  awayLabel,
  side,
  readOnly = false,
  onSwap,
}: CentrePassIndicatorProps) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-2 py-1 border-b bg-muted/20"
      role="group"
      aria-label="Centre pass"
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold whitespace-nowrap">
        Centre pass
      </span>
      <div className="flex items-center gap-2 flex-1 justify-center">
        <SideChip label={homeLabel} active={side === "home"} />
        <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
        <SideChip label={awayLabel} active={side === "away"} />
      </div>
      {!readOnly && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={onSwap}
          aria-label="Swap centre pass"
        >
          Swap
        </Button>
      )}
    </div>
  );
});

function SideChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase truncate max-w-[100px]",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

export default CentrePassIndicator;
