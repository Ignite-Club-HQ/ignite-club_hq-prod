import { memo } from "react";
import { cn } from "@/lib/utils";
import { Pencil, Play } from "lucide-react";

interface ModeToggleProps {
  mode: "edit" | "run";
  onChange: (mode: "edit" | "run") => void;
  /** Disable the Run option when the drill has only one step. */
  canRun?: boolean;
}

/**
 * Segmented toggle between Edit and Run modes. Lives in the top bar.
 * The active option is filled; the other is a subtle text button so the
 * toggle never competes with the pitch.
 */
function ModeToggleImpl({ mode, onChange, canRun = true }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Drill mode"
      className="inline-flex items-center rounded-full border border-border bg-muted/60 p-0.5 shrink-0"
    >
      <button
        type="button"
        onClick={() => onChange("edit")}
        aria-pressed={mode === "edit"}
        className={cn(
          "h-7 px-2.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1",
          mode === "edit"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
      <button
        type="button"
        onClick={() => onChange("run")}
        aria-pressed={mode === "run"}
        disabled={!canRun}
        title={!canRun ? "Add a second step to run this drill" : undefined}
        className={cn(
          "h-7 px-2.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1",
          mode === "run"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          !canRun && "opacity-50 cursor-not-allowed",
        )}
      >
        <Play className="h-3 w-3" />
        Run
      </button>
    </div>
  );
}

export const ModeToggle = memo(ModeToggleImpl);
export default ModeToggle;
