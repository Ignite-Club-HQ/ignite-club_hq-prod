import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface LiveScoreboardBarProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  /** Allowed point increments (basketball: [1,2,3]; netball: [1]). */
  increments: number[];
  readOnly?: boolean;
  disabled?: boolean;
  onScore: (side: "home" | "away", points: number) => void;
}

/**
 * Dominant single-row live scoreboard:
 *   [ HOOPS U12 ]    12 — 8    [ OPPONENT ]
 *
 * - Scores are the largest text on the screen.
 * - Tap a score → +1/+2/+3 popover (fast scoring, no extra steps).
 * - Team labels are small + secondary, no edit icons (rename moved out of live UI).
 */
const LiveScoreboardBar = memo(function LiveScoreboardBar({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  increments,
  readOnly = false,
  disabled = false,
  onScore,
}: LiveScoreboardBarProps) {
  const [open, setOpen] = useState<"home" | "away" | null>(null);
  const interactive = !readOnly && !disabled;

  const handleScore = (side: "home" | "away", pts: number) => {
    onScore(side, pts);
    setOpen(null);
  };

  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 bg-card border-b"
      role="group"
      aria-label="Live scoreboard"
    >
      {/* HOME — label above, score below, right-aligned to the centre dash */}
      <div className="flex flex-col items-end min-w-0 gap-0.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
          title={homeLabel}
        >
          {homeLabel}
        </span>
        <ScoreDisplay
          score={homeScore}
          interactive={interactive}
          open={open === "home"}
          onOpenChange={(o) => setOpen(o ? "home" : null)}
          onScore={(pts) => handleScore("home", pts)}
          increments={increments}
          ariaLabel={`Add points for ${homeLabel}`}
          align="end"
        />
      </div>

      {/* DASH separator */}
      <span className="text-3xl font-light text-muted-foreground/50 px-1 self-end pb-1">—</span>

      {/* AWAY */}
      <div className="flex flex-col items-start min-w-0 gap-0.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
          title={awayLabel}
        >
          {awayLabel}
        </span>
        <ScoreDisplay
          score={awayScore}
          interactive={interactive}
          open={open === "away"}
          onOpenChange={(o) => setOpen(o ? "away" : null)}
          onScore={(pts) => handleScore("away", pts)}
          increments={increments}
          ariaLabel={`Add points for ${awayLabel}`}
          align="start"
        />
      </div>
    </div>
  );
});

interface ScoreDisplayProps {
  score: number;
  interactive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScore: (points: number) => void;
  increments: number[];
  ariaLabel: string;
  align: "start" | "end";
}

function ScoreDisplay({
  score,
  interactive,
  open,
  onOpenChange,
  onScore,
  increments,
  ariaLabel,
  align,
}: ScoreDisplayProps) {
  const display = (
    <span
      className={cn(
        "text-5xl font-extrabold tabular-nums leading-none text-foreground px-2 py-1 rounded-md landscape:text-6xl",
        interactive &&
          "hover:bg-muted/40 active:bg-muted/60 active:scale-95 transition-all cursor-pointer"
      )}
      aria-live="polite"
    >
      {score}
    </span>
  );

  if (!interactive) return display;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-transparent border-0 p-0 m-0 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label={ariaLabel}
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5" align={align} sideOffset={4}>
        <div className="flex items-center gap-1">
          {increments.map((pts) => (
            <Button
              key={pts}
              size="sm"
              className="h-12 min-w-14 px-3 text-lg font-bold"
              onClick={() => onScore(pts)}
              aria-label={`Add ${pts} point${pts === 1 ? "" : "s"}`}
            >
              +{pts}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default LiveScoreboardBar;
