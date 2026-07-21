import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Hand, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimeoutsPanelProps {
  homeLabel: string;
  awayLabel: string;
  /** Remaining timeouts in the current half. */
  homeRemaining: number;
  awayRemaining: number;
  /** Configured per-half allowance (used to render pip count). */
  perHalf: number;
  /** Current half (1 = Q1+Q2, 2 = Q3+Q4). Used for the heading only. */
  half: 1 | 2;
  readOnly?: boolean;
  onCall: (side: "home" | "away") => void;
  onResetHalf: () => void;
}

/**
 * Compact timeouts panel for basketball. FIBA default = 2 in H1, 3 in H2;
 * NBA = 7 total etc. We keep it simple: coach configures `perHalf` once and
 * the panel decrements per call.
 *
 * Rendered as a single-row chip so it sits naturally between the scoreboard
 * and the action bar without stealing valuable court height.
 */
const TimeoutsPanel = memo(function TimeoutsPanel({
  homeLabel,
  awayLabel,
  homeRemaining,
  awayRemaining,
  perHalf,
  half,
  readOnly = false,
  onCall,
  onResetHalf,
}: TimeoutsPanelProps) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 text-xs"
      role="group"
      aria-label="Timeouts"
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold whitespace-nowrap">
        TO · H{half}
      </span>
      <TeamCell
        label={homeLabel}
        remaining={homeRemaining}
        perHalf={perHalf}
        readOnly={readOnly}
        onCall={() => onCall("home")}
      />
      <TeamCell
        label={awayLabel}
        remaining={awayRemaining}
        perHalf={perHalf}
        readOnly={readOnly}
        onCall={() => onCall("away")}
        align="end"
      />
      {!readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onResetHalf}
          aria-label="Reset timeouts for this half"
          title="Reset timeouts"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
});

interface TeamCellProps {
  label: string;
  remaining: number;
  perHalf: number;
  readOnly: boolean;
  onCall: () => void;
  align?: "start" | "end";
}

function TeamCell({ label, remaining, perHalf, readOnly, onCall, align = "start" }: TeamCellProps) {
  const used = Math.max(0, perHalf - remaining);
  return (
    <div
      className={cn(
        "flex-1 min-w-0 flex items-center gap-1.5",
        align === "end" && "justify-end"
      )}
    >
      <span className="truncate text-[10px] text-muted-foreground max-w-[60px]">
        {label}
      </span>
      <div className="flex items-center gap-0.5" aria-label={`${remaining} of ${perHalf} timeouts left`}>
        {Array.from({ length: perHalf }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-3 rounded-sm",
              i < used ? "bg-muted-foreground/30" : "bg-primary"
            )}
          />
        ))}
      </div>
      {!readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onCall}
          disabled={remaining <= 0}
          aria-label={`Call timeout for ${label}`}
          title="Call timeout"
        >
          <Hand className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

export default TimeoutsPanel;
