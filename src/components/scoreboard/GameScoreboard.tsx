import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Pencil, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScoreEntry {
  /** Sequential id for stable keys/undo */
  id: string;
  /** "home" = our team, "away" = opponent */
  side: "home" | "away";
  points: number;
  at: number;
}

interface GameScoreboardProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  /** Allowed point increments. Basketball: [1,2,3]. Netball: [1] (or [1,2] for super shot). */
  increments: number[];
  readOnly?: boolean;
  onScore: (side: "home" | "away", points: number) => void;
  onUndo: () => void;
  onRenameAway: (name: string) => void;
  canUndo: boolean;
  /** When true, scoring (+N) buttons are disabled. Undo + rename remain available. */
  disabled?: boolean;
  className?: string;
}

/**
 * Compact, big-finger-friendly scoreboard for live game scoring.
 * Shared between basketball and netball boards. Sport-specific point values
 * are passed in via `increments` so the same UI works for any score-by-N sport.
 */
const GameScoreboard = memo(function GameScoreboard({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  increments,
  readOnly = false,
  onScore,
  onUndo,
  onRenameAway,
  canUndo,
  className,
}: GameScoreboardProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftAway, setDraftAway] = useState(awayLabel);

  return (
    <div
      className={cn(
        "flex items-stretch gap-2 px-2 py-1.5 border-b bg-card",
        className
      )}
      role="group"
      aria-label="Live scoreboard"
    >
      {/* HOME */}
      <ScoreColumn
        label={homeLabel}
        score={homeScore}
        increments={increments}
        readOnly={readOnly}
        onScore={(pts) => onScore("home", pts)}
        align="left"
      />

      {/* DIVIDER + UNDO */}
      <div className="flex flex-col items-center justify-center gap-1 px-1">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
          vs
        </span>
        {!readOnly && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo last score"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* AWAY */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-end gap-1">
          <span className="text-[10px] font-semibold uppercase truncate text-muted-foreground">
            {awayLabel}
          </span>
          {!readOnly && (
            <Popover open={renameOpen} onOpenChange={(o) => {
              setRenameOpen(o);
              if (o) setDraftAway(awayLabel);
            }}>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4"
                  aria-label="Rename opponent"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="flex flex-col gap-2">
                  <Input
                    value={draftAway}
                    onChange={(e) => setDraftAway(e.target.value)}
                    placeholder="Opponent name"
                    maxLength={24}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRenameAway(draftAway.trim() || "Opponent");
                        setRenameOpen(false);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      onRenameAway(draftAway.trim() || "Opponent");
                      setRenameOpen(false);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <ScoreColumn
          label={null}
          score={awayScore}
          increments={increments}
          readOnly={readOnly}
          onScore={(pts) => onScore("away", pts)}
          align="right"
        />
      </div>
    </div>
  );
});

interface ScoreColumnProps {
  label: string | null;
  score: number;
  increments: number[];
  readOnly: boolean;
  onScore: (points: number) => void;
  align: "left" | "right";
}

function ScoreColumn({
  label,
  score,
  increments,
  readOnly,
  onScore,
  align,
}: ScoreColumnProps) {
  return (
    <div
      className={cn(
        "flex-1 min-w-0 flex flex-col",
        align === "right" && "items-end"
      )}
    >
      {label !== null && (
        <span className="text-[10px] font-semibold uppercase truncate text-muted-foreground">
          {label}
        </span>
      )}
      <div
        className={cn(
          "flex items-center gap-1.5",
          align === "right" && "flex-row-reverse"
        )}
      >
        <span
          className="text-2xl font-extrabold tabular-nums leading-none text-foreground"
          aria-live="polite"
        >
          {score}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1">
            {increments.map((pts) => (
              <Button
                key={pts}
                size="sm"
                variant="secondary"
                className="h-7 min-w-7 px-1.5 text-xs font-bold"
                onClick={() => onScore(pts)}
                aria-label={`Add ${pts} point${pts === 1 ? "" : "s"}`}
              >
                +{pts}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default GameScoreboard;
