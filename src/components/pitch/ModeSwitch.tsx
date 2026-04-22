import { memo } from "react";
import { cn } from "@/lib/utils";
import { Swords, ClipboardList } from "lucide-react";

export type PitchBoardMode = "match" | "training";

interface ModeSwitchProps {
  value: PitchBoardMode;
  onChange: (mode: PitchBoardMode) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Segmented control for switching between Match Mode and Training Mode
 * inside the Pitch Board header.
 */
function ModeSwitchImpl({ value, onChange, disabled, className }: ModeSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Pitch board mode"
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-muted p-0.5 shrink-0",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "match"}
        onClick={() => onChange("match")}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
          value === "match"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Swords className="h-3.5 w-3.5" />
        <span>Match</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "training"}
        onClick={() => onChange("training")}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
          value === "training"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <ClipboardList className="h-3.5 w-3.5" />
        <span>Training</span>
        <span
          className={cn(
            "ml-0.5 rounded-sm px-1 py-0 text-[9px] font-bold uppercase leading-tight tracking-wide",
            value === "training"
              ? "bg-primary text-primary-foreground"
              : "bg-muted-foreground/20 text-muted-foreground"
          )}
        >
          Beta
        </span>
      </button>
    </div>
  );
}

export const ModeSwitch = memo(ModeSwitchImpl);
