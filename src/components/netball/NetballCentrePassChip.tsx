import { memo } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface NetballCentrePassChipProps {
  homeLabel: string;
  awayLabel: string;
  /** Which side has the next centre pass. */
  side: "home" | "away";
  readOnly?: boolean;
  onSwap: () => void;
}

/**
 * Compact floating segmented control that replaces the full-width
 * `CentrePassIndicator` while a netball game is in progress.
 *
 * It sits as a small overlay just above the bottom edge of the court so
 * it never spans the full width nor obscures player tokens. Tapping a
 * side flips the centre pass; the trailing swap button is purely a
 * shortcut for the same action.
 */
const NetballCentrePassChip = memo(function NetballCentrePassChip({
  homeLabel,
  awayLabel,
  side,
  readOnly = false,
  onSwap,
}: NetballCentrePassChipProps) {
  const setSide = (target: "home" | "away") => {
    if (readOnly) return;
    if (target !== side) onSwap();
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/95 backdrop-blur-sm shadow-md px-1 py-0.5"
      role="group"
      aria-label="Centre pass"
    >
      <span className="text-[8.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold pl-1.5 pr-0.5 leading-none">
        CP
      </span>
      <div
        role="radiogroup"
        aria-label="Centre pass side"
        className="inline-flex items-center rounded-full bg-muted/60 p-0.5"
      >
        <SideButton
          label={homeLabel}
          active={side === "home"}
          onClick={() => setSide("home")}
          disabled={readOnly}
        />
        <SideButton
          label={awayLabel}
          active={side === "away"}
          onClick={() => setSide("away")}
          disabled={readOnly}
        />
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap centre pass"
          className="h-5 w-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex items-center justify-center transition-colors mr-0.5"
        >
          <ArrowLeftRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});

function SideButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "px-2 h-5 rounded-full text-[10px] font-semibold leading-none uppercase tracking-tight max-w-[5.5rem] truncate transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      {label}
    </button>
  );
}

export default NetballCentrePassChip;
